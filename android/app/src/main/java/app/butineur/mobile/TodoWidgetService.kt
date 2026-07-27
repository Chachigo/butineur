package app.butineur.mobile

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Alimente la liste défilante du widget todo. Toutes les tâches en cours y
 * passent, compteurs compris — d'où l'adaptateur plutôt que des lignes fixes.
 */
class TodoWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        TodoFactory(applicationContext)
}

private class TodoFactory(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {

    private var items: List<TodoTask> = emptyList()

    override fun onCreate() = Unit

    override fun onDataSetChanged() {
        // Une tâche validée depuis le widget disparaît tout de suite, sans
        // attendre que l'appli ait versé le fait au journal.
        val done = Store.pendingCompleted(ctx)
        items = Store.todo(ctx).filterNot { it.id in done }
    }

    override fun onDestroy() {
        items = emptyList()
    }

    override fun getCount() = items.size

    override fun getViewAt(position: Int): RemoteViews {
        val t = items[position]
        val v = RemoteViews(ctx.packageName, R.layout.item_todo_row)

        // Un compteur doit refléter les taps pas encore versés au journal :
        // sinon la ligne restait figée sur le compte qu'avait l'appli.
        val counter = if (t.kind == "count") Store.task(ctx, t.id) else null
        val count = counter?.let { Store.displayedCount(ctx, it) }
        val done = if (counter != null) count!! >= counter.target else t.done
        val label = when {
            counter == null -> t.label
            done -> "✓"
            else -> "$count/${counter.target}"
        }
        v.setIcon(
            ctx,
            R.id.row_icon,
            R.id.row_icon_img,
            t.icon,
            t.iconPh,
            if (t.kind == "count") "🎯" else "✓",
            18,
        )
        v.setTextViewText(R.id.row_name, t.name)
        v.setTextViewText(R.id.row_go, label)

        val accent = Store.accent(ctx)
        if (done) {
            v.setInt(R.id.row_go, "setBackgroundResource", R.drawable.widget_chip)
            v.tint(R.id.row_go, ctx.getColor(R.color.widget_panel))
            v.setTextColor(R.id.row_go, accent)
        } else {
            v.setInt(R.id.row_go, "setBackgroundResource", R.drawable.widget_pill)
            v.tint(R.id.row_go, accent)
            v.setTextColor(R.id.row_go, ctx.getColor(R.color.widget_go_ink))
        }

        // Le PendingIntent est porté par le widget ; chaque ligne ne fournit
        // que ses propres extras. C'est le mécanisme imposé par RemoteViews.
        v.setOnClickFillInIntent(
            R.id.row_root,
            Intent()
                .putExtra(TodoWidget.EXTRA_TASK, t.id)
                .putExtra(TodoWidget.EXTRA_KIND, t.kind)
                .putExtra(TodoWidget.EXTRA_DONE, done),
        )
        return v
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount() = 1

    override fun getItemId(position: Int) = items[position].id.hashCode().toLong()

    override fun hasStableIds() = true
}
