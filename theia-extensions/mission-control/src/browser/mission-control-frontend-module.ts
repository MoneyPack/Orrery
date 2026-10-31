import { ContainerModule } from "@theia/core/shared/inversify";
import { WidgetFactory } from "@theia/core/lib/browser/widget-manager";
import { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { MenuModelRegistry } from "@theia/core/lib/common/menu";
import { CommonMenus } from "@theia/core/lib/browser/common-menus";
import { KeybindingRegistry } from "@theia/core/lib/browser/keybinding";
import { MissionControlCommands, OrreryIntelligenceCommands, OrreryToolsCommands } from "../common/mission-control-commands";
import { bindViewContribution } from "@theia/core/lib/browser/shell/view-contribution";
import { MissionControlService, OrreryIntelligenceService, OrreryToolsService } from "../common/mission-control-types";
import { MissionControlContribution } from "./mission-control-contribution";
import { MissionControlDesktopAdapter } from "./mission-control-desktop-adapter";
import { MissionControlWidget } from "./mission-control-widget";
import { MissionControlWidgetFactory, MissionControlWidgetProvider } from "./mission-control-widget-factory";
import { OrreryWorkbenchContribution } from "./orrery-workbench-contribution";
import { OrreryIntelligenceDesktopAdapter } from "./orrery-intelligence-adapter";
import { OrreryIntelligenceWidget } from "./orrery-intelligence-widget";
import { OrreryIntelligenceContribution, OrreryIntelligenceWidgetFactory, OrreryIntelligenceWidgetProvider } from "./orrery-intelligence-contribution";
import { OrreryToolsDesktopAdapter } from "./orrery-tools-adapter";
import { OrreryToolsWidget } from "./orrery-tools-widget";
import { OrreryToolsContribution, OrreryToolsWidgetFactory, OrreryToolsWidgetProvider } from "./orrery-tools-contribution";

/** Smoke-only opener, kept off the contribution identifiers so it cannot poison their resolution. */
export const SmokeViewOpener = Symbol("SmokeViewOpener");

export default new ContainerModule((bind) => {
  // The wider workbench composition now provides the real quick-input, quick-access,
  // and preference bindings via @theia/monaco plus @theia/preferences, so this module
  // binds only Orrery views and must not shadow those providers with stubs.
  bind(MissionControlDesktopAdapter).toSelf().inSingletonScope();
  bind(MissionControlService).toService(MissionControlDesktopAdapter);
  bind(MissionControlWidget).toSelf().inTransientScope();
  bind<() => MissionControlWidget>(MissionControlWidgetProvider).toFactory(({ container }) => () => container.get(MissionControlWidget));
  bind(MissionControlWidgetFactory).toSelf().inSingletonScope();
  bind(WidgetFactory).toService(MissionControlWidgetFactory);
  bindViewContribution(bind, MissionControlContribution);

  bind(OrreryIntelligenceDesktopAdapter).toSelf().inSingletonScope();
  bind(OrreryIntelligenceService).toService(OrreryIntelligenceDesktopAdapter);
  bind(OrreryIntelligenceWidget).toSelf().inTransientScope();
  bind<() => OrreryIntelligenceWidget>(OrreryIntelligenceWidgetProvider).toFactory(({ container }) => () => container.get(OrreryIntelligenceWidget));
  bind(OrreryIntelligenceWidgetFactory).toSelf().inSingletonScope();
  bind(WidgetFactory).toService(OrreryIntelligenceWidgetFactory);
  bindViewContribution(bind, OrreryIntelligenceContribution);

  bind(OrreryToolsDesktopAdapter).toSelf().inSingletonScope();
  bind(OrreryToolsService).toService(OrreryToolsDesktopAdapter);
  bind(OrreryToolsWidget).toSelf().inTransientScope();
  bind<() => OrreryToolsWidget>(OrreryToolsWidgetProvider).toFactory(({ container }) => () => container.get(OrreryToolsWidget));
  bind(OrreryToolsWidgetFactory).toSelf().inSingletonScope();
  bind(WidgetFactory).toService(OrreryToolsWidgetFactory);
  bindViewContribution(bind, OrreryToolsContribution);

  // First-run workbench layout: opens the three Orrery side views so a fresh
  // desktop shows Activity Bar plus Side Bar plus Editor plus Panel plus
  // Status Bar with Mission Control populated. Explorer plus Terminal already
  // self-place via their own initializeLayout contributions.
  bind(OrreryWorkbenchContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(OrreryWorkbenchContribution);

  // Exposes a smoke-only opener on the window.
  //
  // The application's lifecycle hooks have already fired by the time the smoke can drive the
  // renderer, so a contribution bound here is resolved but never called. Handing the smoke a
  // function it can invoke on demand sidesteps the lifecycle entirely.
  //
  // Deliberately NOT bound as a `FrontendApplicationContribution`: inversify treats a binding
  // whose factory is asynchronous as an async dependency, and Theia resolves contribution lists
  // synchronously. A single async binding makes `container.getAll` throw, and
  // `ContainerBasedContributionProvider.getContributions` swallows that in a `catch` that only
  // logs — silently discarding *every* contribution for that identifier. Binding this opener as a
  // contribution therefore wiped out all commands, keybindings and menus in the application.
  bind(SmokeViewOpener).toDynamicValue(({ container }) => ({
    open: async (): Promise<string[]> => {
      const log: string[] = [];
      // Reports the View submenu's model labels. Lumino renders submenu popups only while open,
      // so the DOM cannot show them; the model is the renderer-side source of truth Theia builds
      // the submenu from. Stashed on the window so the smoke can read it without re-running the
      // opener or parsing logs.
      try {
        const menus = container.get(MenuModelRegistry);
        const viewMenu = menus.getMenu([...CommonMenus.VIEW, "2_views"]);
        const labels = (viewMenu?.children ?? []).map(child => (child as { label?: string }).label ?? "");
        (window as unknown as { __orreryViewModelLabels?: string[] }).__orreryViewModelLabels = labels;
      } catch {
        (window as unknown as { __orreryViewModelLabels?: string[] }).__orreryViewModelLabels = [];
      }
      // Reports each view's registered keybindings from Theia's own registry. Registration is
      // what makes a shortcut reachable at all; without it the command exists but no keystroke
      // can invoke it, which is the difference between "registered" and "usable" that the menu
      // model cannot show. Stashed like the menu labels so the smoke reads it directly.
      try {
        const keybindings = container.get(KeybindingRegistry);
        const registry: Record<string, string[]> = {};
        for (const commandId of [MissionControlCommands.OPEN.id, OrreryIntelligenceCommands.OPEN.id, OrreryToolsCommands.OPEN.id]) {
          registry[commandId] = keybindings.getKeybindingsForCommand(commandId).map(binding => binding.keybinding);
        }
        (window as unknown as { __orreryKeybindings?: Record<string, string[]> }).__orreryKeybindings = registry;
      } catch {
        (window as unknown as { __orreryKeybindings?: Record<string, string[]> }).__orreryKeybindings = {};
      }
      for (const contribution of [MissionControlContribution, OrreryIntelligenceContribution, OrreryToolsContribution]) {
        try {
          const widget = await container.get(contribution).openView({ activate: false, reveal: true });
          log.push(`${contribution.name}: id=${widget?.id} attached=${String(widget?.isAttached)}`);
        } catch (error) {
          log.push(`${contribution.name}: ${error instanceof Error ? error.message : "failed"}`);
        }
      }
      return log;
    },
  })).inSingletonScope();

  // Publishes the opener on the window as soon as Theia resolves its contribution list. A hook
  // like `onStart` cannot be used on this binding: it is resolved too late for lifecycle methods
  // but the factory itself runs at resolution, which is early enough for the smoke. The factory
  // must stay synchronous — see the warning above about async poisoning.
  bind(FrontendApplicationContribution).toDynamicValue(({ container }) => {
    (window as unknown as { __orreryOpenViews?: () => Promise<string[]> }).__orreryOpenViews =
      () => container.get<{ open: () => Promise<string[]> }>(SmokeViewOpener).open();
    return {};
  }).inSingletonScope();
});
