package app.butineur.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Toutes les tâches en cours, validables directement depuis l'écran d'accueil.
 *
 * Il n'évalue aucune récompense : il empile un fait dans la file et la liste se
 * redessine. L'appli calcule le montant au versement, avec l'horodatage du tap —
 * valider à l'heure puis rouvrir l'appli plus tard ne coûte donc pas de retard.
 */
class TodoWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, render(context, it)) }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.todo_list)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_TAP) return

        // Raccourci « + » de l'en-tête : on note l'intention et on ouvre l'appli.
        if (intent.getBooleanExtra(EXTRA_NEW, false)) {
            Store.requestNewTask(context)
            context.startActivity(
                context.packageManager.getLaunchIntentForPackage(context.packageName)
                    ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }

        val taskId = intent.getStringExtra(EXTRA_TASK) ?: return
        // Un compteur déjà à son objectif : plus rien à ajouter, on ouvre l'appli.
        if (intent.getBooleanExtra(EXTRA_DONE, false)) return

        val kind = intent.getStringExtra(EXTRA_KIND) ?: "complete"
        val gain = Store.todo(context).firstOrNull { it.id == taskId }?.gain ?: 0.0
        Store.pushPending(context, taskId, 1, kind, gain)
        // Tous les widgets, pas seulement celui-ci : le solde doit suivre.
        Widgets.refreshAll(context)
    }

    companion object {
        const val ACTION_TAP = "app.butineur.mobile.TODO_TAP"
        const val EXTRA_TASK = "taskId"
        const val EXTRA_KIND = "kind"
        const val EXTRA_DONE = "done"
        const val EXTRA_NEW = "newTask"

        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, TodoWidget::class.java))
            if (ids.isEmpty()) return
            ids.forEach { mgr.updateAppWidget(it, render(ctx, it)) }
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.todo_list)
        }

        fun render(ctx: Context, widgetId: Int): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_todo)
            v.setOnClickPendingIntent(R.id.todo_title, BalanceWidget.openApp(ctx))
            v.setOnClickPendingIntent(R.id.todo_new, newTaskIntent(ctx))

            val adapter = Intent(ctx, TodoWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                // Rend l'intent unique par widget, sinon toutes les instances
                // partageraient le même adaptateur.
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

        /** Modèle rempli par chaque ligne : il doit rester mutable. */
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
