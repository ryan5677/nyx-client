package com.nyxclient.mod.mixin;

import com.nyxclient.mod.NyxConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.item.HeldItemRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Implements the launcher's "hide hands when HUD is hidden (F1)" option.
 * Vanilla keeps rendering the held item in first person even with the HUD
 * off, which is usually not what people want F1 for (screenshots, recording).
 */
@Mixin(HeldItemRenderer.class)
public class HeldItemRendererMixin {
	@Inject(method = "renderItem", at = @At("HEAD"), cancellable = true)
	private void nyx$hideHandsWhenHudHidden(CallbackInfo ci) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client == null || client.options == null) return;
		if (client.options.hudHidden && NyxConfig.getBool("hideHandsInF1", false)) {
			ci.cancel();
		}
	}
}
