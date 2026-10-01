package com.nyxclient.mod.ui;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.CyclingButtonWidget;
import net.minecraft.text.Text;

/**
 * Restyles every vanilla button on every screen (pause menu, world list,
 * server list, vanilla options, ...) without any mixins: after a screen has
 * rendered, each plain button is painted over with the Nyx look. Hit-testing
 * and click handling stay entirely vanilla, so nothing about how the buttons
 * behave can break - only how they look.
 *
 * Buttons with no label (icon buttons such as language/accessibility) and
 * sliders/checkboxes are left alone so their own graphics stay visible.
 */
public final class NyxButtonStyler {
	private NyxButtonStyler() {}

	public static void register() {
		ScreenEvents.AFTER_INIT.register((client, screen, w, h) ->
				ScreenEvents.afterRender(screen).register((s, ctx, mouseX, mouseY, delta) -> {
					for (ClickableWidget widget : Screens.getButtons(s)) {
						if (widget instanceof ButtonWidget || widget instanceof CyclingButtonWidget<?>) {
							paint(ctx, widget);
						}
					}
				}));
	}

	private static void paint(DrawContext ctx, ClickableWidget b) {
		if (!b.visible) return;
		Text label = b.getMessage();
		if (label == null || label.getString().isEmpty()) return;

		int x = b.getX(), y = b.getY(), w = b.getWidth(), h = b.getHeight();
		boolean hot = b.isHovered() && b.active;

		ctx.fill(x, y, x + w, y + h, hot ? NyxTheme.ROW_HOVER | 0xFF000000 : 0xFF140f27);
		NyxTheme.border(ctx, x, y, w, h, hot ? NyxTheme.accent() : NyxTheme.accent(b.active ? 90 : 40));
		if (hot) ctx.fill(x + 1, y + h - 2, x + w - 1, y + h - 1, NyxTheme.accent(200));

		MinecraftClient mc = MinecraftClient.getInstance();
		int color = !b.active ? 0xFF5d587a : hot ? 0xFFFFFFFF : NyxTheme.TEXT;
		ctx.drawCenteredTextWithShadow(mc.textRenderer, label, x + w / 2, y + (h - 8) / 2, color);
	}
}
