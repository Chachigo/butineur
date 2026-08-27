package app.butineur.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher

/**
 * Cancels the reminders of a task completed from a widget.
 *
 * Without this the scheduled reminder still fired: the app, being closed, had
 * not seen the tap yet and could therefore not unschedule it.
 *
 * The setup mirrors the one from @capacitor/local-notifications — same receiver
 * class, same request code — because two `PendingIntent`s only cancel each other
 * when they match in the sense of `filterEquals`, which ignores extras.
 */
object Notifs {

    /**
     * The web side derives a task's ids per cycle: deadline (base + 3i),
     * reminder (base + 3i + 1) and cheer (base + 2). It schedules
     * `CYCLES_AVANCE` = 4 of them ahead — so we cancel the whole range,
     * otherwise the following cycles still rang after a completion on a widget.
     */
    fun cancelForTask(ctx: Context, base: Int) {
        if (base == 0) return
        for (id in base..base + 11) {
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
