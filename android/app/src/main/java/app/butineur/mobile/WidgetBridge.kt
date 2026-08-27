package app.butineur.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The only native plugin of the project. It does two things: redraw the widgets,
 * and hand back to the app the taps made from them. All the reward logic stays
 * on the web side.
 */
@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridge : Plugin() {

    /** Called as soon as the balance or a counter changes. */
    @PluginMethod
    fun refresh(call: PluginCall) {
        Widgets.refreshAll(context)
        call.resolve()
    }

    /** The app collects the tap queue and empties it, on start and on resume. */
    @PluginMethod
    fun drainPending(call: PluginCall) {
        call.resolve(JSObject().put("items", Store.drainPending(context)))
    }

    /**
     * Offers to pin a widget onto the home screen.
     *
     * The launcher decides: it shows its own confirmation, and some refuse
     * outright. So we return what we know — asked or not — so the web side can
     * explain what to do instead of staying silent. `kind` is either "compteur"
     * or "liste".
     */
    @PluginMethod
    fun requestPin(call: PluginCall) {
        val cible = when (call.getString("kind")) {
            "liste" -> TodoWidget::class.java
            "solde" -> BalanceWidget::class.java
            else -> CounterWidget::class.java
        }
        val mgr = AppWidgetManager.getInstance(context)
        val demande = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            mgr.isRequestPinAppWidgetSupported &&
            mgr.requestPinAppWidget(ComponentName(context, cible), null, null)
        call.resolve(JSObject().put("asked", demande))
    }
}

/**
 * An icon is either an emoji — plain text — or a Phosphor glyph, rendered as an
 * image by [Glyph]. Every layout therefore carries both views, and only the
 * right one is shown.
 */
fun RemoteViews.setIcon(
    ctx: Context,
    textId: Int,
    imageId: Int,
    icon: String,
    isPhosphor: Boolean,
    fallback: String,
    sizeDp: Int,
) {
    val bmp = if (isPhosphor && icon.isNotEmpty()) {
        Glyph.bitmap(ctx, icon, sizeDp, ctx.getColor(R.color.widget_text), Store.accent(ctx))
    } else null

    if (bmp != null) {
        setImageViewBitmap(imageId, bmp)
        setViewVisibility(imageId, View.VISIBLE)
        setViewVisibility(textId, View.GONE)
    } else {
        // Emoji, or fallback when the font could not be loaded.
        setTextViewText(textId, if (isPhosphor) fallback else icon.ifEmpty { fallback })
        setViewVisibility(textId, View.VISIBLE)
        setViewVisibility(imageId, View.GONE)
    }
}

/**
 * Tints a button with the accent color chosen in the settings.
 * `setBackgroundTintList` preserves the drawable's rounded corners, unlike a
 * `setBackgroundColor`. API 31+; below that, the default color stays.
 */
fun RemoteViews.tint(viewId: Int, color: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(color))
    }
}

object Widgets {
    /** Internal action: "the day has rolled over, redraw". */
    const val ACTION_DAY = "app.butineur.mobile.DAY_CHANGED"

    /**
     * @param rebuild rebuild the list widget's layout. Useless after a plain tap
     * — and counter-productive, see [TodoWidget.refresh].
     */
    fun refreshAll(ctx: Context, rebuild: Boolean = true) {
        val mgr = AppWidgetManager.getInstance(ctx)
        mgr.getAppWidgetIds(ComponentName(ctx, BalanceWidget::class.java))
            .forEach { mgr.updateAppWidget(it, BalanceWidget.render(ctx)) }
        mgr.getAppWidgetIds(ComponentName(ctx, CounterWidget::class.java))
            .forEach { mgr.updateAppWidget(it, CounterWidget.render(ctx, it)) }
        TodoWidget.refresh(ctx, rebuild)
        armDayChange(ctx)
    }

    /**
     * Redraws everything at the next day rollover.
     *
     * `updatePeriodMillis` was not enough — the system postpones it while the
     * device sleeps, and a finished counter still showed "8/8 🎉" the next day
     * until the app was reopened. The alarm is rearmed on every redraw, so it
     * never runs out.
     *
     * ponytail: inexact alarm (`setAndAllowWhileIdle`), no permission to ask for.
     * A few minutes late on a day change does not show; move to an exact alarm if
     * it ever matters.
     */
    private fun armDayChange(ctx: Context) {
        val i = Intent(ctx, BalanceWidget::class.java).setAction(ACTION_DAY)
        val pi = PendingIntent.getBroadcast(
            ctx,
            0,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager)
            .setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Store.nextDayStart(ctx), pi)
    }
}
