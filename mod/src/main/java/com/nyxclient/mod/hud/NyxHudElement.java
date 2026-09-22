package com.nyxclient.mod.hud;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * One draggable, independently positioned piece of the Nyx HUD. Implement
 * this and register it with NyxHudManager to add a new overlay - the
 * manager handles drag detection, hit-testing, and position persistence for
 * every registered element the same way, so a new element only needs to
 * describe what it looks like and how big it is, not how dragging works.
 */
public interface NyxHudElement {
	/** Stable identifier, used as the key in the saved-positions file. Never change this for an existing element once it's shipped, or its saved position is orphaned and it silently resets to its default spot. */
	String id();

	/** Whether this element has anything to show right now (reads its own config via NyxConfig). */
	boolean isEnabled(MinecraftClient client);

	/** Content size in GUI-scaled pixels, used for the drag hitbox and the edit-mode outline. */
	int width(MinecraftClient client);
	int height(MinecraftClient client);

	/** Default position (0.0-1.0 fractions of screen) the first time this element is ever shown, before any drag has saved one for it. */
	default double defaultX() { return 0.02; }
	default double defaultY() { return 0.02; }

	/** Draws the element's content with its top-left corner at (x, y). */
	void render(DrawContext context, MinecraftClient client, int x, int y);
}
