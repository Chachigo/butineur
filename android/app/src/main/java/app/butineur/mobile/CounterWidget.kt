package app.butineur.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Configurable counter: every instance dropped on the home screen is bound to
 * its own task, chosen through [CounterConfigActivity].
 *
 * The + button works with the app closed: it stacks a fact in the queue and
 * redraws the widget. No reward computation here — the replay of the log on the
 * app side decides, so the two cannot diverge.
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
        val task = Store.task(context, taskId)
        // Payout of the current step, not of a frozen one: several taps in a row
        // with the app closed all have to count right.
        val gain = task?.gainAt(Store.displayedCount(context, task)) ?: 0.0
        val delta = intent.getIntExtra(EXTRA_DELTA, 1)
        Store.pushPending(context, taskId, delta, "count", gain)
        // Target reached by this tap: the reminder has no reason to exist.
        if (task != null && Store.displayedCount(context, task) >= task.target) {
            Notifs.cancelForTask(context, task.notifBase)
        }
        // Every widget, not just this one: the balance has to follow.
        // Without a rebuild: the list only needs to re-read its data.
        Widgets.refreshAll(context, rebuild = false)
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
                v.setIcon(ctx, R.id.counter_icon, R.id.counter_icon_img, "", false, "🎯", 24)
                v.setTextViewText(R.id.counter_name, ctx.getString(R.string.widget_unassigned))
                v.setTextViewText(R.id.counter_value, "")
                v.setOnClickPendingIntent(R.id.counter_plus, BalanceWidget.openApp(ctx))
                return v
            }

            v.setIcon(ctx, R.id.counter_icon, R.id.counter_icon_img, task.icon, task.iconPh, "🎯", 24)
            v.setTextViewText(R.id.counter_name, task.name)
            v.setOnClickPendingIntent(R.id.counter_name, BalanceWidget.openApp(ctx))

            val count = Store.displayedCount(ctx, task)
            val fini = count >= task.target
            /*
             * A widget cannot animate: `RemoteViews` exposes neither transitions
             * nor loops. What we can do, and what shows on the refresh following
             * the tap, is celebrate the target — the row switches to the accent
             * color and earns its 🎉.
             */
            v.setTextViewText(
                R.id.counter_value,
                "$count/${task.target} ${task.unit}".trim() + if (fini) "  🎉" else "",
            )
            v.setTextColor(
                R.id.counter_value,
                if (fini) Store.accent(ctx) else ctx.getColor(R.color.widget_dim),
            )

            // Target reached: the tick replaces the +, and the button no longer
            // increments — the engine caps the counter at the target anyway.
            val accent = Store.accent(ctx)
            if (fini) {
                v.setTextViewText(R.id.counter_plus, "✓")
                v.setInt(R.id.counter_plus, "setBackgroundResource", R.drawable.widget_btn)
                v.tint(R.id.counter_plus, ctx.getColor(R.color.widget_panel))
                v.setTextColor(R.id.counter_plus, accent)
                v.setOnClickPendingIntent(R.id.counter_plus, BalanceWidget.openApp(ctx))
            } else {
                v.setTextViewText(R.id.counter_plus, "+")
                v.setInt(R.id.counter_plus, "setBackgroundResource", R.drawable.widget_btn_go)
                v.tint(R.id.counter_plus, accent)
                v.setTextColor(R.id.counter_plus, ctx.getColor(R.color.widget_go_ink))
                v.setOnClickPendingIntent(R.id.counter_plus, bump(ctx, widgetId, 1))
            }
            return v
        }

        private fun bump(ctx: Context, widgetId: Int, delta: Int): PendingIntent {
            val i = Intent(ctx, CounterWidget::class.java).apply {
                action = ACTION_BUMP
                // Extras do not count in Intent equality: without distinct data, the
                // + and − buttons would share the same PendingIntent.
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
