// Attachment routing (port-spec F7): sequential upload, order preserved,
// canonical ref_text values appended to the prompt in order.
// A failed attach blocks send until resolved or removed — never send a
// prompt with a dangling attachment reference.
export type Attachment = {
  localId: string;
  name: string;
  dataUrl: string;
  status: 'pending' | 'uploading' | 'attached' | 'failed';
  refText?: string;
  error?: string;
};

export function buildPromptText(text: string, attachments: Attachment[]): string {
  const refs = attachments.filter((a) => a.status === 'attached' && a.refText).map((a) => a.refText!);
  if (refs.length === 0) return text;
  return [text, ...refs].filter(Boolean).join('\n');
}

export function attachmentSendBlocker(attachments: Attachment[]): string | null {
  if (attachments.some((a) => a.status === 'failed')) {
    return 'An attachment failed to upload. Retry it or remove it before sending.';
  }
  if (attachments.some((a) => a.status === 'uploading' || a.status === 'pending')) {
    return 'Wait for attachments to finish uploading before sending.';
  }
  return null;
}

export function reorderAttachments(list: Attachment[], from: number, to: number): Attachment[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}
