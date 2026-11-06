import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import { ContextKeyService } from "@theia/core/lib/browser/context-key-service";
import { ENABLE_AI_CONTEXT_KEY, type AIActivationService } from "@theia/ai-core/lib/browser/ai-activation-service";

/**
 * Keeps Theia AI dormant.
 *
 * `@theia/plugin-ext` depends on `@theia/ai-core` and `@theia/ai-mcp` for the VS Code
 * language-model API bridge, so both are composed whether or not a product wants them, and
 * Theia's default activation service reports the feature *active*. Orrery Intelligence and
 * Orrery Tools are this product's AI and MCP surfaces, with their own trust model, so the
 * Theia AI feature is held inactive: its context key is false, which hides its commands,
 * menus, and views, and `canRun` is false so nothing can be invoked around that.
 */
@injectable()
export class OrreryAIActivationService implements AIActivationService {
  readonly isActive = false;
  readonly canRun = false;
  private readonly activeChanged = new Emitter<boolean>();
  private readonly canRunChanged = new Emitter<boolean>();

  constructor(@inject(ContextKeyService) private readonly contextKeys: ContextKeyService) {}

  get onDidChangeActiveStatus(): Event<boolean> { return this.activeChanged.event; }
  get onDidChangeCanRun(): Event<boolean> { return this.canRunChanged.event; }

  initialize(): void {
    this.contextKeys.createKey(ENABLE_AI_CONTEXT_KEY, false);
  }
}
