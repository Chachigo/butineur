package app.butineur.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.core.content.res.ResourcesCompat

/**
 * Draws a Phosphor glyph into a bitmap.
 *
 * `android:fontFamily="@font/phosphor"` is not enough: a `RemoteViews` is
 * inflated by the launcher, not by the app, and the font is not resolved there —
 * the widget showed an empty square. So the character is rendered here, in our
 * own process where the font is available, and an image is sent instead.
 *
 * The font is duotone: the web side sends **two** characters at the same
 * position, the background then the detail. They are drawn on top of each other,
 * in both colors — otherwise the widget would only show a solid silhouette.
 */
object Glyph {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private var typeface: android.graphics.Typeface? = null

    fun bitmap(ctx: Context, char: String, sizeDp: Int, color: Int, accent: Int): Bitmap? {
        if (char.isEmpty()) return null
        val tf = typeface ?: runCatching {
            ResourcesCompat.getFont(ctx, R.font.phosphor)
        }.getOrNull()?.also { typeface = it } ?: return null

        val size = (sizeDp * ctx.resources.displayMetrics.density).toInt().coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)

        paint.typeface = tf
        paint.textSize = size * 0.86f

        // Vertical centering on the real metrics, not on the box.
        val fm = paint.fontMetrics
        val baseline = size / 2f - (fm.ascent + fm.descent) / 2f
        val canvas = Canvas(bmp)

        // A code point can span two `Char`s: we split on those.
        val points = char.codePoints().toArray()
        paint.color = accent
        canvas.drawText(String(Character.toChars(points[0])), size / 2f, baseline, paint)
        if (points.size > 1) {
            paint.color = color
            canvas.drawText(String(Character.toChars(points[1])), size / 2f, baseline, paint)
        }
        return bmp
    }
}
