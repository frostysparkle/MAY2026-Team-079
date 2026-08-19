import LoginPage from './LoginPage';

/**
 * Registration is a tab on the sign-in screen rather than a separate page, so
 * `/register` renders that same screen with the Register tab already active.
 * Rendering (rather than redirecting) keeps the `/register` URL intact for
 * existing links, bookmarks, and anything already sent out.
 */
export default function RegisterPage() {
  return <LoginPage initialMode="register" />;
}
