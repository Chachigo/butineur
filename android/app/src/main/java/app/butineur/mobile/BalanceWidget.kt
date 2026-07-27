package app.butineur.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Le solde accumulé, sur l'écran d'accueil. Lecture seule. */
class BalanceWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, render(context)) }
    }

    companion object {
        fun render(ctx: Context): RemoteViews =
            RemoteViews(ctx.packageName, R.layout.widget_balance).apply {
                setTextViewText(R.id.balance_amount, Store.balance(ctx))
                setTextViewText(R.id.balance_currency, Store.currency(ctx))
                setOnClickPendingIntent(R.id.balance_root, openApp(ctx))
            }

        fun openApp(ctx: Context): PendingIntent {
            val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
            return PendingIntent.getActivity(
                ctx,
                0,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
