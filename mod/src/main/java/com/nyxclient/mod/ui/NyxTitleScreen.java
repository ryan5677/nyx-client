package com.nyxclient.mod.ui;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen;
import net.minecraft.client.gui.screen.world.SelectWorldScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import net.minecraft.util.Util;

import java.util.Random;

/** Nyx main menu: night sky, moon, shooting stars, four buttons. */
public class NyxTitleScreen extends Screen {
	private static final int STAR_COUNT = 160;

	private final float[] starX = new float[STAR_COUNT];
	private final float[] starY = new float[STAR_COUNT];
	private final float[] starPhase = new float[STAR_COUNT];
	private final int[] starSize = new int[STAR_COUNT];

	public NyxTitleScreen() {
		super(Text.literal("Nyx Client"));
		Random rng = new Random(0x4E5958L);
		for (int i = 0; i < STAR_COUNT; i++) {
			starX[i] = rng.nextFloat();
			starY[i] = rng.nextFloat();
			starPhase[i] = rng.nextFloat() * 6.2831f;
			starSize[i] = rng.nextInt(6) == 0 ? 2 : 1;
		}
	}

	@Override
	protected void init() {
		int w = 200, h = 24, gap = 6;
		int x = this.width / 2 - w / 2;
		int y = this.height / 2 - 10;

		this.addDrawableChild(ButtonWidget.builder(Text.literal("Singleplayer"),
				b -> this.client.setScreen(new SelectWorldScreen(this))).dimensions(x, y, w, h).build());
		this.addDrawableChild(ButtonWidget.builder(Text.literal("Multiplayer"),
				b -> this.client.setScreen(new MultiplayerScreen(this))).dimensions(x, y + (h + gap), w, h).build());
		this.addDrawableChild(ButtonWidget.builder(Text.literal("Settings"),
				b -> this.client.setScreen(new NyxSettingsScreen(this))).dimensions(x, y + (h + gap) * 2, w, h).build());
		this.addDrawableChild(ButtonWidget.builder(Text.literal("Quit Game"),
				b -> this.client.scheduleStop()).dimensions(x, y + (h + gap) * 3, w, h).build());
	}

	@Override
	public boolean shouldCloseOnEsc() {
		return false;
	}

	@Override
	public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
		float time = (Util.getMeasuringTimeMs() % 600000L) / 1000f;

		NyxTheme.gradient(ctx, 0, 0, this.width, this.height, NyxTheme.BG_TOP, NyxTheme.BG_BOTTOM);

		for (int i = 0; i < STAR_COUNT; i++) {
			float twinkle = 0.55f + 0.45f * (float) Math.sin(time * 1.4f + starPhase[i]);
			int a = (int) (60 + 195 * twinkle);
			int sx = (int) (starX[i] * this.width);
			int sy = (int) (starY[i] * this.height);
			ctx.fill(sx, sy, sx + starSize[i], sy + starSize[i], (a << 24) | 0xFFFFFF);
		}

		drawShootingStar(ctx, time);
		drawMoon(ctx);

		// Title, drawn as scaled pixel blocks: matrix transforms changed type between
		// Minecraft versions (3D stack before 1.21.6, 2D after), plain fills never did.
		drawPixelTitle(ctx, "NYX CLIENT", this.width / 2, this.height / 2 - 96, 4);

		ctx.drawCenteredTextWithShadow(this.textRenderer, Text.literal("Minecraft, after dark"),
				this.width / 2, this.height / 2 - 52, NyxTheme.TEXT_DIM);

		super.render(ctx, mouseX, mouseY, delta);
	}

	// 5x7 bitmaps for the letters in the title.
	private static final java.util.Map<Character, String[]> FONT = new java.util.HashMap<>();
	static {
		FONT.put('N', new String[]{"10001", "11001", "10101", "10101", "10011", "10001", "10001"});
		FONT.put('Y', new String[]{"10001", "10001", "01010", "00100", "00100", "00100", "00100"});
		FONT.put('X', new String[]{"10001", "01010", "01010", "00100", "01010", "01010", "10001"});
		FONT.put('C', new String[]{"01111", "10000", "10000", "10000", "10000", "10000", "01111"});
		FONT.put('L', new String[]{"10000", "10000", "10000", "10000", "10000", "10000", "11111"});
		FONT.put('I', new String[]{"11111", "00100", "00100", "00100", "00100", "00100", "11111"});
		FONT.put('E', new String[]{"11111", "10000", "10000", "11110", "10000", "10000", "11111"});
		FONT.put('T', new String[]{"11111", "00100", "00100", "00100", "00100", "00100", "00100"});
	}

	private void drawPixelTitle(DrawContext ctx, String text, int centerX, int top, int px) {
		int letterW = 5 * px, gap = px * 2, spaceW = px * 4;
		int total = 0;
		for (char c : text.toCharArray()) total += (c == ' ' ? spaceW : letterW + gap);
		total -= gap;
		int x = centerX - total / 2;
		int glow = NyxTheme.accent(70);
		for (char c : text.toCharArray()) {
			if (c == ' ') { x += spaceW; continue; }
			String[] rows = FONT.get(c);
			if (rows != null) {
				for (int ry = 0; ry < rows.length; ry++) {
					for (int rx = 0; rx < 5; rx++) {
						if (rows[ry].charAt(rx) != '1') continue;
						int bx = x + rx * px, by = top + ry * px;
						ctx.fill(bx + 2, by + 2, bx + px + 2, by + px + 2, glow);
						ctx.fill(bx, by, bx + px, by + px, NyxTheme.accent());
					}
				}
			}
			x += letterW + gap;
		}
	}

	private void drawMoon(DrawContext ctx) {
		int r = Math.max(14, Math.min(this.width, this.height) / 14);
		int cx = this.width - r * 3;
		int cy = r * 3;
		// soft glow
		for (int i = 6; i >= 1; i--) {
			NyxTheme.disc(ctx, cx, cy, r + i * 4, NyxTheme.withAlpha(0xb9a8ff, 10));
		}
		NyxTheme.disc(ctx, cx, cy, r, 0xFFe9e4ff);
		NyxTheme.disc(ctx, cx - r / 3, cy - r / 4, Math.max(2, r / 4), 0xFFd2cbf0);
		NyxTheme.disc(ctx, cx + r / 3, cy + r / 3, Math.max(2, r / 5), 0xFFd2cbf0);
		NyxTheme.disc(ctx, cx + r / 4, cy - r / 2, Math.max(1, r / 7), 0xFFd9d3f3);
	}

	/** One streak every ~7s, top-right to lower-left, with a fading tail. */
	private void drawShootingStar(DrawContext ctx, float time) {
		float period = 7f;
		float t = (time % period) / 1.2f;
		if (t > 1f) return;
		float headX = this.width * (1.05f - 0.75f * t);
		float headY = this.height * (-0.05f + 0.55f * t);
		for (int i = 0; i < 28; i++) {
			float k = i / 28f;
			int px = (int) (headX + k * this.width * 0.16f);
			int py = (int) (headY - k * this.height * 0.09f);
			int a = (int) ((1f - k) * 220 * (1f - t * 0.4f));
			int size = i < 3 ? 2 : 1;
			ctx.fill(px, py, px + size, py + size, (a << 24) | 0xFFFFFF);
		}
	}
}
