package com.hiraia.tala

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.Drawable
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

object EnrollmentQr {
    private const val SIZE = 700
    private const val BADGE = 90
    private const val GLYPH = 54

    fun create(payload: String, logo: Drawable, ink: Int): Bitmap {
        val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, SIZE, SIZE,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.H, EncodeHintType.MARGIN to 4))
        val pixels = IntArray(SIZE * SIZE)
        for (vertical in 0 until SIZE) for (horizontal in 0 until SIZE)
            pixels[vertical * SIZE + horizontal] = if (matrix[horizontal, vertical]) ink else Color.WHITE
        val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        bitmap.setPixels(pixels, 0, SIZE, 0, 0, SIZE, SIZE)
        val canvas = Canvas(bitmap)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val badgeStart = (SIZE - BADGE) / 2f
        canvas.drawRoundRect(badgeStart, badgeStart, badgeStart + BADGE, badgeStart + BADGE,
            14f, 14f, background)
        val glyphStart = (SIZE - GLYPH) / 2
        logo.setBounds(glyphStart, glyphStart, glyphStart + GLYPH, glyphStart + GLYPH)
        logo.draw(canvas)
        return bitmap
    }
}
