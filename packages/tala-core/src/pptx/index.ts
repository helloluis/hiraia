/**
 * A teacher's own PowerPoint file, read and edited without being rebuilt.
 *
 * `inspectDeck` reads an uploaded .pptx / .potx / .ppsx into plain data: its slides, the words on each that can be
 * changed, and an honest count of everything that is only carried along. `applyEdits` writes changed words, notes
 * and slide order back into the SAME package by splicing its XML, so every part that was not touched leaves
 * exactly as it arrived. Nothing here knows about ZIP files, disks or servers: a package is read through
 * `PartSource` and written from `PptxPackage.entries()`.
 *
 * OWNER: teacher slide uploads (docs/tala/teacher-uploads).
 */
export { PptxError, PptxPackage, NS, CONTENT_TYPE, PACKAGE_LIMITS, isSafePartName, type PackageLimits, type PartSource, type PptxErrorCode, type Relationship } from './opc';
export { parseXml, XmlError, XmlBudgetError, XML_LIMITS, xmlBudget, applySplices, trimEndSpaces, type Splice, type XmlBudget, type XmlDoc, type XmlElement } from './xml';
export { inspectDeck, indexDeck, asPptxError, PPTX_LIMITS, type DeckInspection, type InspectedSlide, type InspectedNotes, type Feature, type FeatureCount } from './inspect';
export { applyEdits, invalidEdits, normaliseEdits, changedSlideCount, noEdits, SLIDE_EDIT_ID, type DeckEdits, type SlideEdit, type ApplyReport } from './apply';
export { alignParagraphs, commonEnds, readTextBody, textBodySplices, textBodyText, tidyParagraphText } from './text';
export type { Box, BlockRole, KeptKind, SlideBlock, SlideObject, SlideSize } from './walk';
