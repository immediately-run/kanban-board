import { useState, type FormEvent } from 'react';
import type { Store } from '../lib/store';
import Dialog from './Dialog';
import Icon from './Icon';

interface Props {
  shared: Store | null;
  busy: boolean;
  onPick: () => void;
  onCreate: (name: string) => void;
  onLeave: () => void;
  onClose: () => void;
  /** Private-config display name; shown as "by" on cards this person touches. */
  displayName: string;
  onSetName: (name: string) => void;
}

function ShareDialog({ shared, busy, onPick, onCreate, onLeave, onClose, displayName, onSetName }: Props) {
  const [name, setName] = useState('');
  const [me, setMe] = useState(displayName);
  const saveMe = () => {
    if (me.trim() !== displayName) onSetName(me);
  };
  const nameRow = (
    <label className="row name-row">
      <span className="small">Your name</span>
      <input
        value={me}
        onChange={(e) => setMe(e.target.value)}
        onBlur={saveMe}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder="Shown on cards you touch"
        aria-label="Your name"
        maxLength={40}
      />
    </label>
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n) onCreate(n);
  };

  return (
    <Dialog title="Share this board" onClose={onClose}>
      {shared ? (
        <div className="share-body">
          <p>
            You are working in the shared space <b>{shared.name ?? shared.spaceId}</b>
            {shared.mode === 'ro' ? ' (read-only)' : ''}. Everyone with access to that space sees this board.
          </p>
          <p className="muted small">
            To invite people, share the space itself from the platform's Spaces page — the app can't invite anyone.
          </p>
          <div className="row wrap">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onPick}>
              <Icon name="users" size={16} /> Open a different space
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onLeave}>
              <Icon name="lock" size={16} /> Back to my private boards
            </button>
          </div>
          {nameRow}
        </div>
      ) : (
        <div className="share-body">
          <p>
            Your boards are private right now. Put them in a <b>shared space</b> and every member of that space gets the
            same boards — each card is its own file, so people can move cards at the same time.
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onPick}>
            <Icon name="users" size={16} /> Open a shared space…
          </button>
          <p className="muted small">Or create a new one:</p>
          <form onSubmit={submit} className="row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Space name, e.g. Team roadmap"
              aria-label="New space name"
              maxLength={80}
            />
            <button type="submit" className="btn btn-ghost" disabled={busy || !name.trim()}>
              Create
            </button>
          </form>
          <p className="muted small">
            Invite people from the platform's Spaces page afterwards — the app itself can't invite anyone. Your private
            boards stay where they are.
          </p>
          {nameRow}
        </div>
      )}
    </Dialog>
  );
}

export default ShareDialog;
