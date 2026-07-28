package app.butineur.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher

/**
 * Annule les rappels d'une tâche validée depuis un widget.
 *
 * Sans ça, le rappel programmé partait quand même : l'appli, fermée, n'avait pas
 * encore vu le tap et ne pouvait donc pas le déprogrammer.
 *
 * Le montage reproduit celui de @capacitor/local-notifications — même classe de
 * receiver, même code de requête — car deux `PendingIntent` ne s'annulent que
 * s'ils se ressemblent au sens de `filterEquals`, qui ignore les extras.
 */
object Notifs {

    /**
     * Le web dérive trois identifiants d'une même tâche : échéance (base),
     * rappel (base + 1) et encouragement (base + 2). On les coupe tous les trois.
     */
    fun cancelForTask(ctx: Context, base: Int) {
        if (base == 0) return
        for (id in base..base + 2) {
            cancelAlarm(ctx, id)
            NotificationManagerCompat.from(ctx).cancel(id)
        }
    }

    private fun cancelAlarm(ctx: Context, id: Int) {
        val intent = Intent(ctx, TimedNotificationPublisher::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pi = PendingIntent.getBroadcast(ctx, id, intent, flags) ?: return
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pi)
    }
}
