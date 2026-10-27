import { describe, expect, it } from 'vitest';
import {
  attachmentSendBlocker,
  buildPromptText,
  reorderAttachments,
  type Attachment,
} from '../src/lib/attachment-routing';

const att = (localId: string, status: Attachment['status'], refText?: string): Attachment => ({
  localId,
  name: `${localId}.png`,
  dataUrl: 'data:image/png;base64,xx',
  status,
  refText,
});

describe('attachment routing order', () => {
  it('appends ref_texts to the prompt in attachment order', () => {
    const text = buildPromptText('look at these', [
      att('a', 'attached', '[file:a]'),
      att('b', 'attached', '[file:b]'),
    ]);
    expect(text).toBe('look at these\n[file:a]\n[file:b]');
  });

  it('ignores unattached files when building the prompt', () => {
    expect(buildPromptText('hi', [att('a', 'pending')])).toBe('hi');
  });

  it('reorder preserves the new order', () => {
    const list = [att('a', 'attached', 'A'), att('b', 'attached', 'B'), att('c', 'attached', 'C')];
    expect(reorderAttachments(list, 0, 2).map((a) => a.localId)).toEqual(['b', 'c', 'a']);
    expect(buildPromptText('', reorderAttachments(list, 0, 2))).toBe('B\nC\nA');
  });
});

describe('send blockers', () => {
  it('a failed attach blocks send until resolved or removed', () => {
    expect(attachmentSendBlocker([att('a', 'failed')])).toMatch(/Retry it or remove it/);
  });
  it('an uploading attach blocks send', () => {
    expect(attachmentSendBlocker([att('a', 'uploading')])).toMatch(/Wait for attachments/);
  });
  it('attached-only lists do not block', () => {
    expect(attachmentSendBlocker([att('a', 'attached', 'A')])).toBeNull();
  });
});
