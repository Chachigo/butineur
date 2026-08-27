package app.butineur.mobile

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Launched by the launcher when a counter widget is dropped: this is where the
 * task that particular instance will show is chosen. That is what makes the
 * widget configurable, and what allows several of them on different tasks.
 *
 * The list comes from `widgetTasks`, written by the app. When it is empty it
 * means no counter task exists yet — we say so explicitly rather than show a
 * bare screen that looks broken.
 */
class CounterConfigActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Cancelled by default: going back leaves no orphan widget.
        setResult(RESULT_CANCELED)
        setContentView(R.layout.activity_counter_config)

        widgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID

        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }

        applyBarInsets()
        findViewById<TextView>(R.id.config_cancel).setOnClickListener { finish() }

        val tasks = Store.tasks(this)
        val list = findViewById<ListView>(R.id.config_list)

        if (tasks.isEmpty()) {
            findViewById<TextView>(R.id.config_empty).visibility = View.VISIBLE
            list.visibility = View.GONE
            return
        }

        list.adapter = object : ArrayAdapter<CounterTask>(this, R.layout.item_counter_task, tasks) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = convertView
                    ?: layoutInflater.inflate(R.layout.item_counter_task, parent, false)
                val t = getItem(position) ?: return v

                // Same rendering as the widgets: emoji as text, Phosphor as image.
                val txt = v.findViewById<TextView>(R.id.item_icon)
                val img = v.findViewById<ImageView>(R.id.item_icon_img)
                val bmp = if (t.iconPh && t.icon.isNotEmpty()) {
                    Glyph.bitmap(
                        this@CounterConfigActivity,
                        t.icon,
                        26,
                        getColor(R.color.widget_text),
                        Store.accent(this@CounterConfigActivity),
                    )
                } else null
                if (bmp != null) {
                    img.setImageBitmap(bmp)
                    img.visibility = View.VISIBLE
                    txt.visibility = View.GONE
                } else {
                    txt.text = t.icon.ifEmpty { "🎯" }
                    txt.visibility = View.VISIBLE
                    img.visibility = View.GONE
                }

                v.findViewById<TextView>(R.id.item_name).text = t.name
                v.findViewById<TextView>(R.id.item_sub).text =
                    "objectif ${t.target} ${t.unit}".trim()
                return v
            }
        }
        list.setOnItemClickListener { _, _, i, _ -> choose(tasks[i].id) }
    }

    /**
     * Since Android 15 activities are edge to edge by default: without this the
     * title slid under the status bar. `fitsSystemWindows` is not reliably
     * enough, so we apply the insets ourselves.
     */
    private fun applyBarInsets() {
        val root = findViewById<View>(R.id.config_root)
        val pad = root.paddingLeft
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad + bars.bottom)
            insets
        }
    }

    private fun choose(taskId: String) {
        Store.setWidgetTask(this, widgetId, taskId)
        AppWidgetManager.getInstance(this)
            .updateAppWidget(widgetId, CounterWidget.render(this, widgetId))
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }
}
