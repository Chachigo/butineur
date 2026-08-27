package app.butineur.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Every live task, completable straight from the home screen.
 *
 * It evaluates no reward: it stacks a fact in the queue and the list redraws.
 * The app computes the amount at pour time, with the timestamp of the tap — so
 * completing on time then reopening the app later costs no late penalty.
 */
class TodoWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, render(context, it)) }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.todo_list)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_TAP) return

        // The "+" shortcut in the header: note the intent and open the app.
        if (intent.getBooleanExtra(EXTRA_NEW, false)) {
            Store.requestNewTask(context)
            context.startActivity(
                context.packageManager.getLaunchIntentForPackage(context.packageName)
                    ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }

        val taskId = intent.getStringExtra(EXTRA_TASK) ?: return
        // A counter already at its target: nothing left to add, open the app.
        if (intent.getBooleanExtra(EXTRA_DONE, false)) return

        val kind = intent.getStringExtra(EXTRA_KIND) ?: "complete"
        val gain = if (kind == "count") {
            // Counter: the payout depends on the step, it lives in `widgetTasks`.
            Store.task(context, taskId)?.let { it.gainAt(Store.displayedCount(context, it)) } ?: 0.0
        } else {
            Store.todo(context).firstOrNull { it.id == taskId }?.gain ?: 0.0
        }
        Store.pushPending(context, taskId, 1, kind, gain)

        // The task is done: its reminders are cancelled, otherwise they still
        // fired — the app, being closed, could not unschedule them itself.
        val counter = Store.task(context, taskId)
        val fini = if (kind == "count") {
            counter != null && Store.displayedCount(context, counter) >= counter.target
        } else true
        if (fini) {
            val base = counter?.notifBase
                ?: Store.todo(context).firstOrNull { it.id == taskId }?.notifBase
            if (base != null) Notifs.cancelForTask(context, base)
        }
        // Every widget, not just this one: the balance has to follow.
        // Without a rebuild: the list only needs to re-read its data.
        Widgets.refreshAll(context, rebuild = false)
    }

    companion object {
        const val ACTION_TAP = "app.butineur.mobile.TODO_TAP"
        const val EXTRA_TASK = "taskId"
        const val EXTRA_KIND = "kind"
        const val EXTRA_DONE = "done"
        const val EXTRA_NEW = "newTask"

        /**
         * `rebuild` rebuilds the layout — needed when the accent changes, but it
         * reinstalls the adapter and can cancel the list refresh. After a plain
         * tap we simply signal that the data has changed.
         */
        fun refresh(ctx: Context, rebuild: Boolean = true) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TodoWidget::class.java))
            if (ids.isEmpty()) return
            if (rebuild) ids.forEach { mgr.updateAppWidget(it, render(ctx, it)) }
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.todo_list)
        }

        fun render(ctx: Context, widgetId: Int): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_todo)
            v.setOnClickPendingIntent(R.id.todo_title, BalanceWidget.openApp(ctx))
            v.setOnClickPendingIntent(R.id.todo_new, newTaskIntent(ctx))

            val adapter = Intent(ctx, TodoWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                // Makes the intent unique per widget, otherwise every instance
                // would share the same adapter.
                data = android.net.Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            v.setRemoteAdapter(R.id.todo_list, adapter)
            v.setEmptyView(R.id.todo_list, R.id.todo_empty)
            v.setPendingIntentTemplate(R.id.todo_list, template(ctx))
            return v
        }

        private fun newTaskIntent(ctx: Context): PendingIntent {
            val i = Intent(ctx, TodoWidget::class.java).apply {
                action = ACTION_TAP
                data = android.net.Uri.parse("newtask://butineur")
                putExtra(EXTRA_NEW, true)
            }
            return PendingIntent.getBroadcast(
                ctx,
                0,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        /** Template filled in by each row: it has to stay mutable. */
        private fun template(ctx: Context): PendingIntent {
            val i = Intent(ctx, TodoWidget::class.java).apply { action = ACTION_TAP }
            return PendingIntent.getBroadcast(
                ctx,
                0,
                i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
        }
    }
}
