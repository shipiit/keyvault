import { render } from 'preact';
import { VaultApp } from './VaultApp.jsx';
import './styles.css';

/**
 * The toolbar popup.
 *
 * Renders the same application as the full page, in `compact` mode: Chrome
 * caps popups at 800×600, which is not enough for a labelled sidebar plus
 * three panes. Sharing the component means the popup cannot fall behind the
 * full page as features are added.
 */
render(<VaultApp compact />, document.getElementById('root'));
