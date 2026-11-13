import { BUILTIN_TEMPLATES, Id } from '@hiraia/tala-core';
import { HttpError, requireUser, type Handler, type ServerModule } from '../../kernel/types';
import { createPlanPdf } from './pdf';
export { createPlanPdf } from './pdf';

export const planPdf: Handler<'print.planPdf'> = async (ctx, input) => {
  const user = requireUser(ctx);
  const snapshot = ctx.services.records.planSnapshot(user.id, Id.parse((input.params as { planId: string }).planId));
  if (!snapshot) throw new HttpError('not_found', 'This lesson could not be found.');
  const plan = snapshot.plan.data;
  const template = BUILTIN_TEMPLATES.find(t => t.id === plan.templateId) ?? ctx.services.records.get(user.id, 'template', plan.templateId)?.data;
  if (!template) throw new HttpError('not_found', 'The template for this lesson could not be found.');
  const placement = plan.placements[0];
  const classRecord = placement ? ctx.services.records.get(user.id, 'class', placement.classId) : null;
  const schoolYear = classRecord && !classRecord.deletedAt ? ctx.services.records.get(user.id, 'school_year', classRecord.data.schoolYearId) : null;
  const ids = [...new Set(Object.values(plan.competencies).flat())];
  const competencies = plan.curriculumVersion ? ctx.services.curriculum.getCompetencies(plan.curriculumVersion, ids) : [];
  const lookup = new Map(competencies.map(c => [c.id, c]));
  const binary = await createPlanPdf({
    plan,
    sections: snapshot.sections.filter(s => !s.deletedAt).map(s => s.data),
    template,
    class: classRecord && !classRecord.deletedAt ? classRecord.data : undefined,
    schoolYear: schoolYear && !schoolYear.deletedAt ? schoolYear.data : undefined,
    teacherName: user.displayName,
    paper: input.query.paper,
    lang: plan.language,
    competencyLookup: id => lookup.get(id),
    includeImages: input.query.images,
  });
  return { binary, contentType: 'application/pdf', filename: `tala-${plan.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf` };
};
export const printModule: ServerModule = {
  name: 'print',
  migrations: [],
  handlers: { 'print.planPdf': planPdf },
};
