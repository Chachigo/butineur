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
    /** Glyphe Phosphor : à rendre avec `@font/phosphor` plutôt qu'en emoji. */
    val iconPh: Boolean,
    val count: Int,
    val target: Int,
    val unit: String,
    /** Jour auquel `count` se rapporte : au-delà, le compteur est reparti à zéro. */
    val day: Long,
    /** Gain de chaque cran, chiffré par le web : `gains[i]` fait passer de i à i+1. */
    val gains: List<Double>,
) {
    /** Ce que rapporterait le prochain +1, depuis le compte affiché. */
    fun gainAt(count: Int): Double = gains.getOrElse(count) { 0.0 }
}

data class TodoTask(
    val id: String,
    val name: String,
    val icon: String,
    val iconPh: Boolean,
    /** « count » ou « complete » : ce que le bouton déclenche. */
    val kind: String,
    /** Déjà formaté par le web — le natif ne calcule aucun montant. */
    val label: String,
    /** Ce que le prochain tap rapportera, chiffré par le web. */
    val gain: Double,
    val done: Boolean,
)

/**
 * Le pont avec le web.
 *
 * @capacitor/preferences écrit dans ce même fichier SharedPreferences, en
 * clés/valeurs brutes. Les widgets lisent donc directement ce que le JS a
 * écrit : aucun plugin de lecture, aucune base partagée, aucune duplication
 * de la logique métier côté natif.
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
     * Solde affiché : celui calculé par l'appli, plus ce que les taps en attente
     * rapporteront. Le natif ne calcule aucune récompense — il additionne des
     * montants que le web a déjà chiffrés et déposés dans la file. L'appli
     * recalcule tout au rejeu à sa prochaine ouverture et corrige si besoin.
     */
    fun balance(ctx: Context): String {
        val raw = prefs(ctx).getString(KEY_BALANCE_RAW, null)?.toDoubleOrNull()
            ?: return prefs(ctx).getString(KEY_BALANCE, null) ?: "0"
        return format(raw + pendingGain(ctx))
    }

    /** Même rendu que `fmt` côté web : arrondi au dixième, virgule décimale. */
    private fun format(n: Double): String {
        val r = Math.round(n * 10) / 10.0
        return if (r == Math.floor(r)) r.toLong().toString()
        else String.format(java.util.Locale.FRANCE, "%.1f", r)
    }

    fun currency(ctx: Context): String = prefs(ctx).getString(KEY_CURRENCY, null) ?: ""

    fun budgetLabel(ctx: Context): String =
        prefs(ctx).getString(KEY_LABEL, null)?.ifEmpty { null } ?: "budget loisirs"

    /** Couleur d'accentuation choisie dans les réglages, repli sur le vert. */
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
                )
            }
        }.getOrDefault(emptyList())
    }

    fun task(ctx: Context, id: String?): CounterTask? =
        if (id == null) null else tasks(ctx).firstOrNull { it.id == id }

    /** Tâches à faire maintenant, déjà triées par urgence côté web. */
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
                )
            }
        }.getOrDefault(emptyList())
    }

    // --- association widget <-> tâche (le widget compteur est paramétrable) ---

    fun widgetTask(ctx: Context, widgetId: Int): String? =
        widgetPrefs(ctx).getString("w$widgetId", null)

    fun setWidgetTask(ctx: Context, widgetId: Int, taskId: String) {
        widgetPrefs(ctx).edit().putString("w$widgetId", taskId).apply()
    }

    fun clearWidget(ctx: Context, widgetId: Int) {
        widgetPrefs(ctx).edit().remove("w$widgetId").apply()
    }

    /** Drapeau lu puis effacé par l'appli au démarrage : elle ouvre l'éditeur. */
    fun requestNewTask(ctx: Context) {
        prefs(ctx).edit().putString("newTaskRequested", "1").apply()
    }

    // --- file des taps faits depuis un widget ---

    /**
     * Incrément fait appli fermée. La file est append-only, exactement comme le
     * journal d'événements : le widget est un troisième « appareil » qui ne sait
     * qu'ajouter des faits. L'appli la vide au démarrage suivant, rien ne se perd.
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

    /** Somme des gains annoncés par le web pour les taps pas encore versés. */
    private fun pendingGain(ctx: Context): Double {
        val arr = readPending(prefs(ctx).getString(KEY_PENDING, null))
        var sum = 0.0
        for (i in 0 until arr.length()) sum += arr.optJSONObject(i)?.optDouble("gain", 0.0) ?: 0.0
        return sum
    }

    /**
     * Tâches validées depuis le widget mais pas encore versées au journal.
     * Elles disparaissent de la liste « à faire » : sans ça, un tap ne
     * donnerait aucun retour visible tant que l'appli n'a pas été rouverte.
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
     * Ce que le widget doit afficher : le compte écrit par l'appli s'il date bien
     * d'aujourd'hui, plus les taps qu'elle n'a pas encore récupérés. Plafonné à
     * l'objectif, comme dans le moteur.
     *
     * C'est ce qui permet au widget de savoir qu'un objectif est atteint sans que
     * l'appli tourne : aucun service en arrière-plan n'est nécessaire.
     *
     * ponytail: granularité au jour. Un compteur réglé sur plusieurs jours peut
     * afficher 0 à tort tant que l'appli n'a pas été rouverte — elle recalcule
     * tout au rejeu, donc le solde reste juste.
     */
    fun displayedCount(ctx: Context, t: CounterTask): Int {
        val base = if (t.day == dayNum(ctx, System.currentTimeMillis())) t.count else 0
        return (base + pendingToday(ctx, t.id)).coerceIn(0, t.target)
    }

    /** Même définition que `dayNum` côté web, réglage de bascule compris. */
    private fun dayNum(ctx: Context, ts: Long): Long {
        val shift = (prefs(ctx).getString(KEY_DAY_START, null)?.toIntOrNull() ?: 0) * 3_600_000L
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
