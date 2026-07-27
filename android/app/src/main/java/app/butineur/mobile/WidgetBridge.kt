package app.butineur.mobile

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
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
 * Une icône est soit un emoji — du texte — soit un glyphe Phosphor, rendu en
 * image par [Glyph]. Chaque disposition porte donc les deux vues, et on
 * n'affiche que celle qui convient.
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
        Glyph.bitmap(ctx, icon, sizeDp, ctx.getColor(R.color.widget_text))
    } else null

    if (bmp != null) {
        setImageViewBitmap(imageId, bmp)
        setViewVisibility(imageId, View.VISIBLE)
        setViewVisibility(textId, View.GONE)
    } else {
        // Emoji, ou repli si la police n'a pas pu être chargée.
        setTextViewText(textId, if (isPhosphor) fallback else icon.ifEmpty { fallback })
        setViewVisibility(textId, View.VISIBLE)
        setViewVisibility(imageId, View.GONE)
    }
}

/**
 * Teinte un bouton avec la couleur d'accentuation choisie dans les réglages.
 * `setBackgroundTintList` préserve les coins arrondis du drawable, contrairement
 * à un `setBackgroundColor`. API 31+ ; en dessous, la couleur par défaut reste.
 */
fun RemoteViews.tint(viewId: Int, color: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        setColorStateList(viewId, "setBackgroundTintList", ColorStateList.valueOf(color))
    }
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
