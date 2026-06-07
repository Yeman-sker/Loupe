// The mock "Acme settings" host page being inspected. A stand-in for an
// arbitrary app — NOT part of Loupe. Every pickable node opts in via data-pick.
// Scope is locked here: the picker only ever resolves [data-pick] inside this tree.

type Pk = {
  "data-pick": string;
  "data-tag": string;
  "data-name": string;
  "data-sel": string;
};

function pk(id: string, tag: string, name: string, sel: string): Pk {
  return { "data-pick": id, "data-tag": tag, "data-name": name, "data-sel": sel };
}

export function MockHost({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mh">
      <div className="mh-bg" aria-hidden="true" />
      <div className="mh-top">
        <div className="mh-brand">
          <span className="mh-glyph" /> Acme
        </div>
        <nav className="mh-nav">
          <a {...pk("nav-over", "a", "Overview", "nav a")}>Overview</a>
          <a className="on" {...pk("nav-set", "a", "“Settings”", "nav a.on")}>
            Settings
          </a>
          <a {...pk("nav-bill", "a", "Billing", "nav a")}>Billing</a>
        </nav>
        <span className="mh-spacer" />
        <span className="mh-avatar" {...pk("avatar", "button", "avatar", "button.avatar")} />
      </div>

      <div className="mh-main">
        <h1 className="mh-h" {...pk("title", "h1", "“Account settings”", "main h1")}>
          {title}
        </h1>
        <p className="mh-sub" {...pk("sub", "p", "“Manage your…”", "main p.sub")}>
          {sub}
        </p>

        <div className="mh-banner" {...pk("banner", "div", "upgrade banner", "div.banner")}>
          <p>
            <b>Free plan.</b> Upgrade to unlock unlimited members and API access.
          </p>
          <button className="mh-btn" {...pk("upgrade", "button", "“Upgrade”", "button.upgrade")}>
            Upgrade
          </button>
        </div>

        <section className="mh-panel" {...pk("panel", "section", "Profile panel", "section.panel")}>
          <div className="mh-panel-h" {...pk("ph", "h2", "“Profile”", "section h2")}>
            Profile
          </div>
          <div className="mh-field">
            <label>Full name</label>
            <div className="mh-input" {...pk("f-name", "input", "“Full name”", "input#name")}>
              Ada Lovelace
            </div>
          </div>
          <div className="mh-field">
            <label>Email</label>
            <div className="mh-input" {...pk("f-email", "input", "“Email”", "input#email")}>
              ada@acme.com
            </div>
          </div>
          <div className="mh-actions">
            <button className="mh-btn primary" {...pk("save", "button", "“Save changes”", "button.primary")}>
              Save changes
            </button>
            <button className="mh-btn" {...pk("cancel", "button", "“Cancel”", "button.ghost")}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
