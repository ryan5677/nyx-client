package com.nyxclient.mod.hud;

import com.nyxclient.mod.NyxConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * FPS / coordinates / CPS, drawn as one stacked block. The first HUD
 * element built on the NyxHudManager framework - a template for whatever
 * gets added next (armor bar, saturation bar, crosshair, etc.).
 */
public class StatsHudElement implements NyxHudElement {
	private static final int LINE_HEIGHT = 11;
	private static final Deque<Long> CLICKS = new ArrayDeque<>();
	private static boolean wasAttacking = false;

	private static void recordClickIfAttacking(MinecraftClient client) {
		boolean attacking = client.options.attackKey.isPressed();
		if (attacking && !wasAttacking) CLICKS.addLast(System.currentTimeMillis());
		wasAttacking = attacking;
	}

	private static int currentCps() {
		long cutoff = System.currentTimeMillis() - 1000L;
		while (!CLICKS.isEmpty() && CLICKS.peekFirst() < cutoff) CLICKS.removeFirst();
		return CLICKS.size();
	}

	private List<String> lines(MinecraftClient client) {
		List<String> lines = new ArrayList<>();
		if (client.player == null) return lines;
		if (NyxConfig.getBool("fpsCounter", false)) lines.add(client.getCurrentFps() + " FPS");
		if (NyxConfig.getBool("coords", false)) {
			lines.add(String.format("%.1f, %.1f, %.1f",
					client.player.getX(), client.player.getY(), client.player.getZ()));
		}
		if (NyxConfig.getBool("cpsCounter", false)) lines.add(currentCps() + " CPS");
		return lines;
	}

	/** In edit mode, always show something to grab even with every counter off - otherwise there's nothing on screen to drag. */
	private List<String> displayLines(MinecraftClient client) {
		List<String> lines = lines(client);
		if (lines.isEmpty() && NyxHudManager.isEditMode()) return List.of("Nyx HUD (drag me)");
		return lines;
	}

	@Override
	public String id() {
		return "stats";
	}

	@Override
	public boolean isEnabled(MinecraftClient client) {
		return !lines(client).isEmpty();
	}

	@Override
	public int width(MinecraftClient client) {
		int widest = 0;
		for (String line : displayLines(client)) widest = Math.max(widest, client.textRenderer.getWidth(line));
		return widest;
	}

	@Override
	public int height(MinecraftClient client) {
		return displayLines(client).size() * LINE_HEIGHT;
	}

	@Override
	public void render(DrawContext context, MinecraftClient client, int x, int y) {
		recordClickIfAttacking(client);
		List<String> lines = displayLines(client);
		if (lines.isEmpty()) return;

		TextRenderer font = client.textRenderer;
		int color = NyxHudManager.isEditMode() ? 0xFFFFFF : NyxConfig.accentColor();
		int lineY = y;
		for (String line : lines) {
			context.drawTextWithShadow(font, Text.literal(line), x, lineY, color);
			lineY += LINE_HEIGHT;
		}
	}
}
