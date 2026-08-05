package app.butineur.mobile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import androidx.core.content.res.ResourcesCompat

/**
 * Dessine un glyphe Phosphor dans un bitmap.
 *
 * `android:fontFamily="@font/phosphor"` ne suffit pas : une `RemoteViews` est
 * inflatée par le launcher, pas par l'appli, et la police n'y est pas résolue —
 * le widget affichait un carré vide. On rend donc le caractère ici, dans notre
 * propre processus où la police est disponible, et on envoie une image.
 *
 * La police est duotone : le web envoie **deux** caractères à la même position,
 * le fond puis le détail. On les dessine l'un sur l'autre, dans les deux
 * couleurs — sinon le widget n'afficherait qu'une silhouette pleine.
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

        // Centrage vertical sur les métriques réelles, pas sur la boîte.
        val fm = paint.fontMetrics
        val baseline = size / 2f - (fm.ascent + fm.descent) / 2f
        val canvas = Canvas(bmp)

        // Un point de code peut tenir sur deux `Char` : on découpe dessus.
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
