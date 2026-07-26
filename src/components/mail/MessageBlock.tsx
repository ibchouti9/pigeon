import { useState } from 'react';
import { useMail } from '../../store/mail';
import { toast } from '../../store/toast';
import { downloadBase64 } from '../../lib/download';
import { cn } from '../../lib/cn';
import { formatBytes, formatMessageTimestamp, formatTimestampSpoken } from '../../lib/format';
import type { Attachment, Message } from '../../types';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Monogram } from '../primitives/Monogram';
import { SkeletonBar, SkeletonCircle } from '../primitives/Feedback';
import styles from './MessageBlock.module.css';

export interface MessageBlockProps {
  message: Message;
  /** Resolved display name — "You" for the user's own messages. */
  senderName: string;
  /** Address shown only for the first message from each participant (§5.6). */
  showAddress: boolean;
  /** "to Dana, Sana" — precomputed so this component stays a pure renderer. */
  recipientsLabel: string;
  /** Whether this message defaults to the 32px collapsed line. */
  collapsed: boolean;
  /** Whether the user may toggle collapse at all (§5.6 default rule). */
  collapsible: boolean;
  onToggleCollapse: () => void;
  quotedOpen: boolean;
  onToggleQuoted: () => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

/** C-8 Message block — expanded and collapsed forms of one message in a thread. */
export function MessageBlock({
  message,
  senderName,
  showAddress,
  recipientsLabel,
  collapsed,
  collapsible,
  onToggleCollapse,
  quotedOpen,
  onToggleQuoted,
  loading,
  error,
  onRetry,
}: MessageBlockProps) {
  const spokenTimestamp = formatTimestampSpoken(message.date);
  const label = `Message from ${senderName}, ${spokenTimestamp}`;

  const provider = useMail((s) => s.provider);
  const [downloading, setDownloading] = useState<string | null>(null);

  /** §5.6's attachment chip: "click downloads. No preview." */
  async function download(attachment: Attachment) {
    if (downloading) return;
    setDownloading(attachment.id);
    try {
      const base64 = await provider.downloadAttachment(message.id, attachment.id);
      downloadBase64(base64, attachment.filename, attachment.mimeType);
    } catch {
      toast.error("This attachment didn't download. It's still in Gmail.", {
        label: 'Try again',
        run: () => void download(attachment),
      });
    } finally {
      setDownloading(null);
    }
  }

  if (loading) {
    return (
      <article aria-label={label} aria-busy="true" className={styles.block}>
        <span className={styles.gutter}>
          <SkeletonCircle size={28} />
        </span>
        <div className={styles.body}>
          <span className="visually-hidden">Loading</span>
          <div className={styles.skeletonBody}>
            <SkeletonBar width="35%" />
            <SkeletonBar width="92%" />
            <SkeletonBar width="70%" />
          </div>
        </div>
      </article>
    );
  }

  if (error) {
    return (
      <article aria-label={label} className={styles.block}>
        <span className={styles.gutter}>
          <Monogram name={senderName} email={message.from.email} size={28} />
        </span>
        <div className={styles.body}>
          <p className={cn('t-sm', styles.error)}>
            This message didn't load.
            {onRetry && (
              <Button variant="tertiary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
          </p>
        </div>
      </article>
    );
  }

  const timestamp = formatMessageTimestamp(message.date);

  if (collapsed) {
    return (
      <article aria-label={label} className={styles.block}>
        <span className={styles.gutter}>
          <Monogram name={senderName} email={message.from.email} size={20} />
        </span>
        <button
          type="button"
          aria-expanded="false"
          className={cn('t-sm', styles.collapsedButton)}
          onClick={onToggleCollapse}
        >
          <span className={styles.collapsedSender}>{senderName}</span>
          <span className={styles.collapsedPreview}>{message.body.slice(0, 80)}</span>
          <span className={cn('t-mono-sm', styles.collapsedTimestamp)}>{timestamp}</span>
        </button>
      </article>
    );
  }

  const headerContent = (
    <>
      <span className={styles.senderLine}>
        <span className={cn('t-lg', styles.senderName)}>{senderName}</span>
        {showAddress && (
          <span className={cn('t-xs', styles.senderAddress)}>&lt;{message.from.email}&gt;</span>
        )}
      </span>
      <span className={cn('t-mono-sm', styles.timestamp)}>{timestamp}</span>
    </>
  );

  return (
    <article aria-label={label} className={cn(styles.block, styles.expanded)}>
      <span className={styles.gutter}>
        <Monogram name={senderName} email={message.from.email} size={28} />
      </span>
      <div className={styles.body}>
        {collapsible ? (
          <button
            type="button"
            aria-expanded="true"
            className={cn(styles.headerRow, styles.headerButton)}
            onClick={onToggleCollapse}
          >
            {headerContent}
          </button>
        ) : (
          <div className={styles.headerRow}>{headerContent}</div>
        )}
        <p className={cn('t-xs', styles.recipients)}>{recipientsLabel}</p>
        <hr className={styles.hairline} />
        <p className={cn('t-md', styles.messageBody)}>{message.body}</p>

        {message.quoted && (
          <>
            <button
              type="button"
              className={styles.quotedToggle}
              aria-expanded={quotedOpen}
              aria-label={quotedOpen ? 'Hide quoted text' : 'Show quoted text'}
              onClick={onToggleQuoted}
            >
              ···
            </button>
            {quotedOpen && (
              <p className={cn('t-sm', styles.quoted)}>{message.quoted}</p>
            )}
          </>
        )}

        {message.attachments.length > 0 && (
          <div className={styles.attachments}>
            {message.attachments.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cn('t-xs', styles.attachment)}
                aria-label={`Download ${a.filename}, ${formatBytes(a.size)}`}
                aria-busy={downloading === a.id || undefined}
                onClick={() => void download(a)}
              >
                <Icon name="attach" size={16} className={styles.attachmentIcon} />
                <span className={styles.attachmentName}>{a.filename}</span>
                <span className={styles.attachmentSize}>· {formatBytes(a.size)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
