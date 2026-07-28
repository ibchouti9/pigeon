import { MailPlaceScreen } from '../components/mail/MailPlaceScreen';

/**
 * Mail the user sent.
 *
 * Not a §2.1 place — a conversation you replied to is in your inbox and here
 * at the same time — so this is a read over `in:sent` rather than somewhere a
 * thread lives. Until now a message you sent that nobody answered was
 * invisible in the whole product.
 */
export function SentRoute() {
  return <MailPlaceScreen place="sent" />;
}
