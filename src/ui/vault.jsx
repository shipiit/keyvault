import { render } from 'preact';
import { VaultApp } from './VaultApp.jsx';
import './styles.css';

/**
 * The full-page vault, opened from the extension's options entry.
 *
 * Same component as the popup, given the room to show every pane at once.
 */
render(<VaultApp />, document.getElementById('root'));
