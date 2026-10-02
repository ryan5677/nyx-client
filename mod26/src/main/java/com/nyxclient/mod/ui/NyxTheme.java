package com.nyxclient.mod.ui;

import com.nyxclient.mod.NyxConfig;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Shared colours and small drawing helpers so every Nyx screen looks the same. */
public final class NyxTheme {
	public static final int BG_TOP = 0xFF05060f;
	public static final int BG_BOTTOM = 0xFF140d2b;
	public static final int PANEL = 0xE0100c1f;
	public static final int PANEL_LIGHT = 0xE01b1533;
	public static final int ROW = 0xB0171229;
	public static final int ROW_HOVER = 0xD0251c47;
	public static final int TEXT = 0xFFEDE9FE;
	public static final int TEXT_DIM = 0xFF8b86a8;

	private NyxTheme() {}

	public static int accent() {
		return 0xFF000000 | NyxConfig.accentColor();
	}

	public static int accent(int alpha) {
		return (alpha << 24) | NyxConfig.accentColor();
	}

	public static int withAlpha(int rgb, int alpha) {
		return (alpha << 24) | (rgb & 0xFFFFFF);
	}

	public static void gradient(GuiGraphicsExtractor g, int x1, int y1, int x2, int y2, int top, int bottom) {
		int h = y2 - y1;
		if (h <= 0) return;
		for (int i = 0; i < h; i++) {
			float t = h == 1 ? 0f : (float) i / (h - 1);
			g.fill(x1, y1 + i, x2, y1 + i + 1, lerp(top, bottom, t));
		}
	}

	public static int lerp(int a, int b, float t) {
		int aa = (a >>> 24) & 255, ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
		int ba = (b >>> 24) & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
		int ra = (int) (aa + (ba - aa) * t);
		int rr = (int) (ar + (br - ar) * t);
		int rg = (int) (ag + (bg - ag) * t);
		int rb = (int) (ab + (bb - ab) * t);
		return (ra << 24) | (rr << 16) | (rg << 8) | rb;
	}

	public static void border(GuiGraphicsExtractor g, int x, int y, int w, int h, int color) {
		g.fill(x, y, x + w, y + 1, color);
		g.fill(x, y + h - 1, x + w, y + h, color);
		g.fill(x, y, x + 1, y + h, color);
		g.fill(x + w - 1, y, x + w, y + h, color);
	}

	public static void disc(GuiGraphicsExtractor g, int cx, int cy, int r, int color) {
		for (int dy = -r; dy <= r; dy++) {
			int w = (int) Math.sqrt((double) r * r - (double) dy * dy);
			g.fill(cx - w, cy + dy, cx + w + 1, cy + dy + 1, color);
		}
	}
}
