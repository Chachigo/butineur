package app.butineur.mobile

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Le seul plugin natif du projet. Il ne fait que deux choses : redessiner les
 * widgets, et rendre à l'appli les taps faits depuis ceux-ci. Toute la logique
 * de récompense reste côté web.
 */
@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridge : Plugin() {

    /** Appelé dès que le solde ou un compteur change. */
    @PluginMethod
    fun refresh(call: PluginCall) {
        Widgets.refreshAll(context)
        call.resolve()
    }

    /** L'appli récupère la file des taps et la vide, au démarrage et au retour au premier plan. */
    @PluginMethod
    fun drainPending(call: PluginCall) {
        call.resolve(JSObject().put("items", Store.drainPending(context)))
    }
}

/**
 * Une icône est soit un emoji, soit un glyphe Phosphor. `RemoteViews` ne sait pas
 * changer de police à l'exécution : chaque disposition porte donc deux vues
 * superposées, et on n'affiche que la bonne.
 */
fun RemoteViews.setIcon(emojiId: Int, phId: Int, icon: String, isPhosphor: Boolean, fallback: String) {
    val usePh = isPhosphor && icon.isNotEmpty()
    val shown = if (usePh) phId else emojiId
    val hidden = if (usePh) emojiId else phId
    setViewVisibility(shown, View.VISIBLE)
    setViewVisibility(hidden, View.GONE)
    setTextViewText(shown, icon.ifEmpty { fallback })
}

object Widgets {
    fun refreshAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        mgr.getAppWidgetIds(ComponentName(ctx, BalanceWidget::class.java))
            .forEach { mgr.updateAppWidget(it, BalanceWidget.render(ctx)) }
        mgr.getAppWidgetIds(ComponentName(ctx, CounterWidget::class.java))
            .forEach { mgr.updateAppWidget(it, CounterWidget.render(ctx, it)) }
        TodoWidget.refresh(ctx)
    }
}
