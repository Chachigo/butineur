package app.butineur.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Compteur paramétrable : chaque instance posée sur l'écran d'accueil est
 * associée à sa propre tâche, choisie via [CounterConfigActivity].
 *
 * Le bouton + fonctionne appli fermée : il empile un fait dans la file et
 * redessine le widget. Aucun calcul de récompense ici — c'est le rejeu du
 * journal côté appli qui décide, donc les deux ne peuvent pas diverger.
 */
class CounterWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, render(context, it)) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_BUMP) return

        val widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        val taskId = Store.widgetTask(context, widgetId) ?: return
        Store.pushPending(context, taskId, intent.getIntExtra(EXTRA_DELTA, 1))
        AppWidgetManager.getInstance(context).updateAppWidget(widgetId, render(context, widgetId))
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        ids.forEach { Store.clearWidget(context, it) }
    }

    companion object {
        const val ACTION_BUMP = "app.butineur.mobile.BUMP"
        const val EXTRA_DELTA = "delta"

        fun render(ctx: Context, widgetId: Int): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_counter)
            val task = Store.task(ctx, Store.widgetTask(ctx, widgetId))

            if (task == null) {
                v.setIcon(R.id.counter_icon, R.id.counter_icon_ph, "", false, "🎯")
                v.setTextViewText(R.id.counter_name, ctx.getString(R.string.widget_unassigned))
                v.setTextViewText(R.id.counter_value, "")
                v.setOnClickPendingIntent(R.id.counter_plus, BalanceWidget.openApp(ctx))
                return v
            }

            v.setIcon(R.id.counter_icon, R.id.counter_icon_ph, task.icon, task.iconPh, "🎯")
            v.setTextViewText(R.id.counter_name, task.name)
            v.setOnClickPendingIntent(R.id.counter_name, BalanceWidget.openApp(ctx))

            val count = Store.displayedCount(ctx, task)
            v.setTextViewText(R.id.counter_value, "$count/${task.target} ${task.unit}".trim())

            // Objectif atteint : la coche remplace le +, et le bouton n'incrémente
            // plus — le moteur plafonne de toute façon le compteur à l'objectif.
            if (count >= task.target) {
                v.setTextViewText(R.id.counter_plus, "✓")
                v.setInt(R.id.counter_plus, "setBackgroundResource", R.drawable.widget_btn)
                v.setTextColor(R.id.counter_plus, ctx.getColor(R.color.widget_go))
                v.setOnClickPendingIntent(R.id.counter_plus, BalanceWidget.openApp(ctx))
            } else {
                v.setTextViewText(R.id.counter_plus, "+")
                v.setInt(R.id.counter_plus, "setBackgroundResource", R.drawable.widget_btn_go)
                v.setTextColor(R.id.counter_plus, ctx.getColor(R.color.widget_go_ink))
                v.setOnClickPendingIntent(R.id.counter_plus, bump(ctx, widgetId, 1))
            }
            return v
        }

        private fun bump(ctx: Context, widgetId: Int, delta: Int): PendingIntent {
            val i = Intent(ctx, CounterWidget::class.java).apply {
                action = ACTION_BUMP
                // Les extras ne comptent pas dans l'égalité d'un Intent : sans data
                // distincte, les boutons + et − partageraient le même PendingIntent.
                data = Uri.parse("bump://$widgetId/$delta")
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                putExtra(EXTRA_DELTA, delta)
            }
            return PendingIntent.getBroadcast(
                ctx,
                0,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
