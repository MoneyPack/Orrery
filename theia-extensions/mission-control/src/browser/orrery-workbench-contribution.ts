import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplication } from "@theia/core/lib/browser/frontend-application";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { MissionControlContribution } from "./mission-control-contribution";
import { OrreryIntelligenceContribution } from "./orrery-intelligence-contribution";
import { OrreryToolsContribution } from "./orrery-tools-contribution";

/**
 * First-run workbench layout for the Orrery desktop.
 *
 * Theia already owns the VSCode regions — Activity Bar plus Side Bar plus
 * Editor Group plus Panel plus Status Bar come from the composed
 * `@theia/navigator`, `@theia/editor`, `@theia/terminal`, and friends packages.
 * Explorer and Terminal each declare their own `initializeLayout`, so they
 * self-place. This contribution gives the three Orrery views the same
 * treatment: Mission Control left, Intelligence plus Tools right.
 *
 * Runs only when no stored layout exists — `FrontendApplication` calls
 * `initializeLayout` solely on the `createDefaultLayout` path, so a saved
 * user layout is never clobbered.
 */
@injectable()
export class OrreryWorkbenchContribution implements FrontendApplicationContribution {
  constructor(
    @inject(MissionControlContribution) private readonly missions: MissionControlContribution,
    @inject(OrreryIntelligenceContribution) private readonly intelligence: OrreryIntelligenceContribution,
    @inject(OrreryToolsContribution) private readonly tools: OrreryToolsContribution,
  ) {}

  async initializeLayout(_app: FrontendApplication): Promise<void> {
    await this.missions.openView({ activate: false, reveal: true });
    await this.intelligence.openView({ activate: false, reveal: true });
    await this.tools.openView({ activate: false, reveal: true });
  }
}
