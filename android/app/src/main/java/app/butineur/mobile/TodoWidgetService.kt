package app.butineur.mobile

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Feeds the scrolling list of the todo widget. Every live task goes through it,
 * counters included — hence the adapter rather than fixed rows.
 */
class TodoWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        TodoFactory(applicationContext)
}

private class TodoFactory(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {

    private var items: List<TodoTask> = emptyList()

    override fun onCreate() = Unit

    override fun onDataSetChanged() {
        // A task completed from the widget disappears at once, without waiting
        // for the app to pour the fact into the log.
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

        // A counter has to reflect taps not yet poured into the log: otherwise
        // the row stayed stuck on the count the app had.
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

        // The PendingIntent is carried by the widget; each row only supplies its
        // own extras. That is the mechanism RemoteViews imposes.
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
