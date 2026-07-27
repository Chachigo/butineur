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
 */
object Glyph {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private var typeface: android.graphics.Typeface? = null

    fun bitmap(ctx: Context, char: String, sizeDp: Int, color: Int): Bitmap? {
        if (char.isEmpty()) return null
        val tf = typeface ?: runCatching {
            ResourcesCompat.getFont(ctx, R.font.phosphor)
        }.getOrNull()?.also { typeface = it } ?: return null

        val size = (sizeDp * ctx.resources.displayMetrics.density).toInt().coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)

        paint.typeface = tf
        paint.color = color
        paint.textSize = size * 0.86f

        // Centrage vertical sur les métriques réelles, pas sur la boîte.
        val fm = paint.fontMetrics
        val baseline = size / 2f - (fm.ascent + fm.descent) / 2f
        Canvas(bmp).drawText(char, size / 2f, baseline, paint)
        return bmp
    }
}
