/** Persistent GM shortcut for the v14 Compendium Directory sidebar. */
const BUTTON_ID = "bcc-compendium-open";

export function injectBCCShortcut(_application, html) {
  if (!game.user?.isGM || typeof game.bcc?.open !== "function") return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!(root instanceof HTMLElement)) return;
  if (root.querySelector(`#${BUTTON_ID}`)) return;

  // v14 uses an ApplicationV2 sidebar tab. Unlike the old V1 DOM, its
  // .directory-header .header-actions container is not guaranteed to exist.
  // Put our toolbar immediately before the directory body, within the render
  // root, so the ordinary renderCompendiumDirectory hook restores it after
  // every redraw, navigation and search.
  const header = root.matches(".directory-header, .sidebar-header") ? root :
    root.querySelector(":scope > .directory-header, :scope > .sidebar-header, .directory-header, .sidebar-header");
  const directory = root.querySelector(".directory-list, .directory-content, [data-part='directory'], .directory-container");
  const toolbar = document.createElement("div");
  toolbar.className = "bcc-sidebar-shortcut";
  toolbar.dataset.bcc = "shortcut";
  const button = document.createElement("button");
  button.type = "button";
  button.id = BUTTON_ID;
  button.className = "bcc-sidebar-open";
  button.title = "Abrir Book Compendium Converter";
  button.setAttribute("aria-label", "Abrir Book Compendium Converter");
  button.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i><span>Book Compendium Converter</span>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void game.bcc.open().catch(error => {
      console.error("BCC | Falha ao abrir pelo atalho:", error);
      ui.notifications.error(`BCC | ${error.message}`);
    });
  });
  toolbar.append(button);
  if (header?.parentElement) header.insertAdjacentElement("afterend", toolbar);
  else if (directory?.parentElement) directory.insertAdjacentElement("beforebegin", toolbar);
  else root.prepend(toolbar);
}
