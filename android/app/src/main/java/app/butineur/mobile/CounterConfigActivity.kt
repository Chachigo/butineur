package app.butineur.mobile

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Lancée par le launcher au moment où l'on pose un widget compteur : on choisit
 * la tâche que cette instance-là affichera. C'est ce qui rend le widget
 * paramétrable, et permet d'en poser plusieurs sur des tâches différentes.
 *
 * La liste vient de `widgetTasks`, écrit par l'appli. Si elle est vide, c'est
 * qu'aucune tâche à compteur n'existe encore — on le dit explicitement plutôt
 * que d'afficher un écran nu qui a l'air cassé.
 */
class CounterConfigActivity : AppCompatActivity() {

    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Annulé par défaut : si l'on revient en arrière, pas de widget orphelin.
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
                v.findViewById<TextView>(R.id.item_icon).text = t.icon.ifEmpty { "🎯" }
                v.findViewById<TextView>(R.id.item_name).text = t.name
                v.findViewById<TextView>(R.id.item_sub).text =
                    "objectif ${t.target} ${t.unit}".trim()
                return v
            }
        }
        list.setOnItemClickListener { _, _, i, _ -> choose(tasks[i].id) }
    }

    /**
     * Depuis Android 15 les activités sont bord à bord par défaut : sans ça,
     * le titre passait sous la barre d'état. `fitsSystemWindows` ne suffit pas
     * de façon fiable, on applique les insets nous-mêmes.
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
