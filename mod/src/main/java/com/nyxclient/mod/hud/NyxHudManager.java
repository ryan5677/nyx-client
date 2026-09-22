package com.nyxclient.mod.hud;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

/**
 * The small "rendering engine" every Nyx HUD element goes through: keeps
 * the registry of elements, handles drag input once per tick for whichever
 * one is currently being dragged, and draws every enabled element at its
 * saved position each frame. Adding a new HUD element means implementing
 * NyxHudElement and calling register() once at startup - dragging,
 * hit-testing, and position persistence all come for free from here.
 */
public final class NyxHudManager {
	private static final List<NyxHudElement> ELEMENTS = new ArrayList<>();

	private static boolean editMode = false;
	private static NyxHudElement dragTarget = null;
	private static double dragStartMouseX, dragStartMouseY;
	private static double dragStartElemX, dragStartElemY;

	private NyxHudManager() {}

	public static void register(NyxHudElement element) {
		ELEMENTS.add(element);
	}

	public static boolean isEditMode() {
		return editMode;
	}

	public static void toggleEditMode() {
		editMode = !editMode;
		if (!editMode) dragTarget = null;
	}

	/** Call once per client tick. */
	public static void tick(MinecraftClient client) {
		if (!editMode || client.player == null) {
			dragTarget = null;
			return;
		}
		handleDrag(client);
	}

	/**
	 * Polls the mouse directly via GLFW rather than hooking Minecraft's own
	 * click handling - the vanilla input system is built around Screens, and
	 * this needs to work while playing with no Screen open. Deliberately
	 * mixin-free: one fewer thing that can silently break on a Minecraft
	 * version bump.
	 */
	private static void handleDrag(MinecraftClient client) {
		long window = client.getWindow().getHandle();
		boolean leftDown = GLFW.glfwGetMouseButton(window, GLFW.GLFW_MOUSE_BUTTON_LEFT) == GLFW.GLFW_PRESS;

		double[] mx = new double[1];
		double[] my = new double[1];
		GLFW.glfwGetCursorPos(window, mx, my);
		double scale = client.getWindow().getScaleFactor();
		double mouseX = mx[0] / scale;
		double mouseY = my[0] / scale;

		int screenW = client.getWindow().getScaledWidth();
		int screenH = client.getWindow().getScaledHeight();

		if (leftDown && dragTarget == null) {
			// Later-registered elements are checked first, so anything drawn
			// on top (last) also wins hit-testing ties when overlapping.
			for (int i = ELEMENTS.size() - 1; i >= 0; i--) {
				NyxHudElement el = ELEMENTS.get(i);
				if (!el.isEnabled(client) && !editMode) continue;
				if (hitTest(client, el, mouseX, mouseY, screenW, screenH)) {
					dragTarget = el;
					dragStartMouseX = mouseX;
					dragStartMouseY = mouseY;
					dragStartElemX = NyxPositionStore.x(el);
					dragStartElemY = NyxPositionStore.y(el);
					break;
				}
			}
		} else if (!leftDown && dragTarget != null) {
			NyxPositionStore.save();
			dragTarget = null;
		}

		if (dragTarget != null) {
			double newX = dragStartElemX + (mouseX - dragStartMouseX) / Math.max(1, screenW);
			double newY = dragStartElemY + (mouseY - dragStartMouseY) / Math.max(1, screenH);
			NyxPositionStore.set(dragTarget, clamp01(newX), clamp01(newY));
		}
	}

	private static boolean hitTest(MinecraftClient client, NyxHudElement el, double mouseX, double mouseY, int screenW, int screenH) {
		int x = (int) (NyxPositionStore.x(el) * screenW);
		int y = (int) (NyxPositionStore.y(el) * screenH);
		int w = el.width(client);
		int h = el.height(client);
		return mouseX >= x - 2 && mouseX <= x + w + 2 && mouseY >= y - 2 && mouseY <= y + h + 2;
	}

	private static double clamp01(double v) {
		return Math.max(0.0, Math.min(1.0, v));
	}

	/** Call once per HUD render pass. */
	public static void renderAll(DrawContext context, MinecraftClient client) {
		if (client.options.hudHidden && !editMode) return;
		int screenW = client.getWindow().getScaledWidth();
		int screenH = client.getWindow().getScaledHeight();

		for (NyxHudElement el : ELEMENTS) {
			boolean enabled = el.isEnabled(client);
			if (!enabled && !editMode) continue;

			int x = (int) (NyxPositionStore.x(el) * screenW);
			int y = (int) (NyxPositionStore.y(el) * screenH);

			if (editMode) {
				int w = el.width(client);
				int h = el.height(client);
				boolean isDragging = el == dragTarget;
				context.fill(x - 3, y - 3, x + w + 3, y + h + 3, isDragging ? 0x552A9DF4 : 0x33FFFFFF);
			}
			el.render(context, client, x, y);
		}
	}
}
