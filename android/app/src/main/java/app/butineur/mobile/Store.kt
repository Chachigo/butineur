package app.butineur.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

data class CounterTask(
    val id: String,
    val name: String,
    val icon: String,
    /** Phosphor glyph: to be drawn with `@font/phosphor` rather than as emoji. */
    val iconPh: Boolean,
    val count: Int,
    val target: Int,
    val unit: String,
    /** Day `count` refers to: past it, the counter has gone back to zero. */
    val day: Long,
    /** Payout of each step, priced by the web side: `gains[i]` goes from i to i+1. */
    val gains: List<Double>,
    /** Base of this task's notification ids. */
    val notifBase: Int,
) {
    /** What the next +1 would pay, from the displayed count. */
    fun gainAt(count: Int): Double = gains.getOrElse(count) { 0.0 }
}

data class TodoTask(
    val id: String,
    val name: String,
    val icon: String,
    val iconPh: Boolean,
    /** "count" or "complete": what the button triggers. */
    val kind: String,
    /** Already formatted by the web side — the native side computes no amount. */
    val label: String,
    /** What the next tap will pay, priced by the web side. */
    val gain: Double,
    val done: Boolean,
    /** Base of this task's notification ids. */
    val notifBase: Int,
)

/**
 * The bridge to the web side.
 *
 * @capacitor/preferences writes into this very SharedPreferences file, as raw
 * key/values. The widgets therefore read straight from what the JS wrote: no
 * reading plugin, no shared database, no duplication of the business logic on
 * the native side.
 */
object Store {
    private const val FILE = "CapacitorStorage"
    private const val WIDGETS = "widgets"

    private const val KEY_BALANCE = "balance"
    private const val KEY_BALANCE_RAW = "balanceRaw"
    private const val KEY_CURRENCY = "currency"
    private const val KEY_LABEL = "budgetLabel"
    private const val KEY_ACCENT = "accent"
    private const val KEY_DAY_START = "dayStart"
    private const val KEY_TASKS = "widgetTasks"
    private const val KEY_TODO = "widgetTodo"
    private const val KEY_PENDING = "pendingCounts"

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private fun widgetPrefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(WIDGETS, Context.MODE_PRIVATE)

    /**
     * Displayed balance: the one computed by the app, plus what the pending taps
     * will pay. The native side computes no reward — it adds up amounts the web
     * side has already priced and dropped in the queue. The app recomputes
     * everything on replay at its next start and corrects if need be.
     */
    fun balance(ctx: Context): String {
        val raw = prefs(ctx).getString(KEY_BALANCE_RAW, null)?.toDoubleOrNull()
            ?: return prefs(ctx).getString(KEY_BALANCE, null) ?: "0"
        return format(raw + pendingGain(ctx))
    }

    /** Same rendering as `fmt` on the web side: rounded to the cent, decimal comma. */
    private fun format(n: Double): String {
        val r = Math.round(n * 100) / 100.0
        return if (r == Math.floor(r)) r.toLong().toString()
        else String.format(java.util.Locale.FRANCE, "%.2f", r)
    }

    fun currency(ctx: Context): String = prefs(ctx).getString(KEY_CURRENCY, null) ?: ""

    fun budgetLabel(ctx: Context): String =
        prefs(ctx).getString(KEY_LABEL, null)?.ifEmpty { null } ?: "budget loisirs"

    /** Accent color chosen in the settings, falling back to green. */
    fun accent(ctx: Context): Int =
        runCatching { android.graphics.Color.parseColor(prefs(ctx).getString(KEY_ACCENT, null)) }
            .getOrDefault(ctx.getColor(R.color.widget_go))

    fun tasks(ctx: Context): List<CounterTask> {
        val raw = prefs(ctx).getString(KEY_TASKS, null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                CounterTask(
                    id = o.getString("id"),
                    name = o.optString("name"),
                    icon = o.optString("icon"),
                    iconPh = o.optBoolean("iconPh"),
                    count = o.optInt("count"),
                    target = o.optInt("target"),
                    unit = o.optString("unit"),
                    day = o.optLong("day"),
                    gains = o.optJSONArray("gains").let { g ->
                        (0 until (g?.length() ?: 0)).map { g!!.optDouble(it, 0.0) }
                    },
                    notifBase = o.optInt("notifBase"),
                )
            }
        }.getOrDefault(emptyList())
    }

    fun task(ctx: Context, id: String?): CounterTask? =
        if (id == null) null else tasks(ctx).firstOrNull { it.id == id }

    /** Tasks to do now, already sorted by urgency on the web side. */
    fun todo(ctx: Context): List<TodoTask> {
        val raw = prefs(ctx).getString(KEY_TODO, null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                TodoTask(
                    id = o.getString("id"),
                    name = o.optString("name"),
                    icon = o.optString("icon"),
                    iconPh = o.optBoolean("iconPh"),
                    kind = o.optString("kind", "complete"),
                    label = o.optString("label"),
                    gain = o.optDouble("gain", 0.0),
                    done = o.optBoolean("done"),
                    notifBase = o.optInt("notifBase"),
                )
            }
        }.getOrDefault(emptyList())
    }

    // --- widget <-> task binding (the counter widget is configurable) ---

    fun widgetTask(ctx: Context, widgetId: Int): String? =
        widgetPrefs(ctx).getString("w$widgetId", null)

    fun setWidgetTask(ctx: Context, widgetId: Int, taskId: String) {
        widgetPrefs(ctx).edit().putString("w$widgetId", taskId).apply()
    }

    fun clearWidget(ctx: Context, widgetId: Int) {
        widgetPrefs(ctx).edit().remove("w$widgetId").apply()
    }

    /** Flag read then cleared by the app on start: it opens the editor. */
    fun requestNewTask(ctx: Context) {
        prefs(ctx).edit().putString("newTaskRequested", "1").apply()
    }

    // --- queue of taps made from a widget ---

    /**
     * Increment made with the app closed. The queue is append-only, exactly like
     * the event log: the widget is a third "device" that only knows how to add
     * facts. The app drains it on the next start, nothing is lost.
     */
    fun pushPending(
        ctx: Context,
        taskId: String,
        delta: Int,
        kind: String = "count",
        gain: Double = 0.0,
    ) {
        val p = prefs(ctx)
        val arr = readPending(p.getString(KEY_PENDING, null))
        arr.put(
            JSONObject()
                .put("kind", kind)
                .put("taskId", taskId)
                .put("delta", delta)
                .put("gain", gain)
                .put("ts", System.currentTimeMillis()),
        )
        p.edit().putString(KEY_PENDING, arr.toString()).apply()
    }

    /** Sum of the payouts announced by the web side for taps not yet poured. */
    private fun pendingGain(ctx: Context): Double {
        val arr = readPending(prefs(ctx).getString(KEY_PENDING, null))
        var sum = 0.0
        for (i in 0 until arr.length()) sum += arr.optJSONObject(i)?.optDouble("gain", 0.0) ?: 0.0
        return sum
    }

    /**
     * Tasks completed from the widget but not yet poured into the log. They
     * disappear from the "to do" list: without this, a tap gave no visible
     * feedback until the app was reopened.
     */
    fun pendingCompleted(ctx: Context): Set<String> {
        val arr = readPending(prefs(ctx).getString(KEY_PENDING, null))
        val out = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("kind") == "complete") out.add(o.optString("taskId"))
        }
        return out
    }

    fun drainPending(ctx: Context): JSONArray {
        val p = prefs(ctx)
        val arr = readPending(p.getString(KEY_PENDING, null))
        p.edit().remove(KEY_PENDING).apply()
        return arr
    }

    private fun readPending(raw: String?): JSONArray =
        runCatching { JSONArray(raw ?: "[]") }.getOrDefault(JSONArray())

    private fun pendingToday(ctx: Context, taskId: String): Int {
        val arr = readPending(prefs(ctx).getString(KEY_PENDING, null))
        val today = dayNum(ctx, System.currentTimeMillis())
        var sum = 0
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("taskId") == taskId &&
                o.optString("kind") == "count" &&
                dayNum(ctx, o.optLong("ts")) == today
            ) {
                sum += o.optInt("delta")
            }
        }
        return sum
    }

    /**
     * What the widget has to display: the count written by the app if it really
     * dates from today, plus the taps it has not collected yet. Capped at the
     * target, as in the engine.
     *
     * This is what lets the widget know a target is reached without the app
     * running: no background service is needed.
     *
     * ponytail: day granularity. A counter set over several days may wrongly show
     * 0 until the app is reopened — the app recomputes everything on replay, so
     * the balance stays right.
     */
    fun displayedCount(ctx: Context, t: CounterTask): Int {
        val base = if (t.day == dayNum(ctx, System.currentTimeMillis())) t.count else 0
        return (base + pendingToday(ctx, t.id)).coerceIn(0, t.target)
    }

    /**
     * Instant of the next day rollover, `dayStart` setting included.
     * That is when a counter goes back to zero — hence when to redraw.
     */
    fun nextDayStart(ctx: Context): Long {
        val shift = (prefs(ctx).getString(KEY_DAY_START, null)?.toIntOrNull() ?: 0) * 60_000L
        val c = Calendar.getInstance()
        c.timeInMillis = System.currentTimeMillis() - shift
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        c.add(Calendar.DAY_OF_MONTH, 1)
        return c.timeInMillis + shift
    }

    /** Same definition as `dayNum` on the web side, rollover setting included. */
    private fun dayNum(ctx: Context, ts: Long): Long {
        val shift = (prefs(ctx).getString(KEY_DAY_START, null)?.toIntOrNull() ?: 0) * 60_000L
        val local = Calendar.getInstance()
        local.timeInMillis = ts - shift
        val utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        utc.clear()
        utc.set(
            local.get(Calendar.YEAR),
            local.get(Calendar.MONTH),
            local.get(Calendar.DAY_OF_MONTH),
        )
        return utc.timeInMillis / 86_400_000L
    }
}
