package com.nyxclient.mod.ui;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.CycleButton;
import net.minecraft.network.chat.Component;

/**
 * Restyles every vanilla button on every screen without mixins: after a
 * screen has drawn, each plain button is painted over with the Nyx look.
 * Clicks and hit-testing stay entirely vanilla. Unlabelled icon buttons,
 * sliders and checkboxes are left alone.
 */
public final class NyxButtonStyler {
	private NyxButtonStyler() {}

	public static void register() {
		ScreenEvents.AFTER_INIT.register((client, screen, w, h) ->
				ScreenEvents.afterExtract(screen).register((s, graphics, mouseX, mouseY, delta) -> {
					for (AbstractWidget widget : Screens.getWidgets(s)) {
						if (widget instanceof Button || widget instanceof CycleButton<?>) {
							paint(graphics, widget);
						}
					}
				}));
	}

	private static void paint(GuiGraphicsExtractor g, AbstractWidget b) {
		if (!b.visible) return;
		Component label = b.getMessage();
		if (label == null || label.getString().isEmpty()) return;

		int x = b.getX(), y = b.getY(), w = b.getWidth(), h = b.getHeight();
		boolean hot = b.isHovered() && b.active;

		g.fill(x, y, x + w, y + h, hot ? (NyxTheme.ROW_HOVER | 0xFF000000) : 0xFF140f27);
		NyxTheme.border(g, x, y, w, h, hot ? NyxTheme.accent() : NyxTheme.accent(b.active ? 90 : 40));
		if (hot) g.fill(x + 1, y + h - 2, x + w - 1, y + h - 1, NyxTheme.accent(200));

		Minecraft mc = Minecraft.getInstance();
		String text = label.getString();
		int color = !b.active ? 0xFF5d587a : hot ? 0xFFFFFFFF : NyxTheme.TEXT;
		g.text(mc.font, text, x + w / 2 - mc.font.width(text) / 2, y + (h - 8) / 2, color, true);
	}
}
