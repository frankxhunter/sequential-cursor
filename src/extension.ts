import * as vscode from 'vscode';

// ─── State ────────────────────────────────────────────────────────────────────

interface SessionState {
  editor: vscode.TextEditor;
  /** Snapshot of all original selections when the session started */
  originalSelections: vscode.Selection[];
  /** Index of the selection currently being edited */
  currentIndex: number;
  /** Decoration type used to dim non-active selections */
  dimDecoration: vscode.TextEditorDecorationType;
  /** Decoration type used to highlight the active selection */
  activeDecoration: vscode.TextEditorDecorationType;
  /** Status bar item showing progress */
  statusItem: vscode.StatusBarItem;
}

let session: SessionState | undefined;

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('sequentialCursor.startSequentialEdit', startSequentialEdit),
    vscode.commands.registerCommand('sequentialCursor.confirmAndNext', confirmAndNext),
    vscode.commands.registerCommand('sequentialCursor.skipAndNext', skipAndNext),
    vscode.commands.registerCommand('sequentialCursor.navigateNext', navigateNext),
    vscode.commands.registerCommand('sequentialCursor.navigatePrev', navigatePrev),
    vscode.commands.registerCommand('sequentialCursor.cancel', cancelSession),
    // Cancel automatically if the user switches editors
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (session) { cancelSession(); }
    }),
  );
}

export function deactivate() {
  if (session) { cleanupSession(); }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function startSequentialEdit() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const selections = editor.selections;
  if (selections.length <= 1) {
    vscode.window.showInformationMessage(
      'Sequential Cursor: You need at least 2 cursors/selections to use this mode.'
    );
    return;
  }

  // If a session is already active, cancel it first
  if (session) { cleanupSession(); }

  // Sort selections top-to-bottom so we navigate in reading order
  const sorted = [...selections].sort((a, b) =>
    a.start.line !== b.start.line
      ? a.start.line - b.start.line
      : a.start.character - b.start.character
  );

  const config = vscode.workspace.getConfiguration('sequentialCursor');
  const highlightColor = config.get<string>('highlightColor', '#FF6B6B');

  const dimDecoration = vscode.window.createTextEditorDecorationType({
    opacity: '0.4',
    backgroundColor: new vscode.ThemeColor('editor.selectionBackground'),
  });

  const activeDecoration = vscode.window.createTextEditorDecorationType({
    border: `2px solid ${highlightColor}`,
    backgroundColor: highlightColor + '33', // 20% opacity
    borderRadius: '2px',
  });

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  session = {
    editor,
    originalSelections: sorted,
    currentIndex: 0,
    dimDecoration,
    activeDecoration,
    statusItem,
  };

  vscode.commands.executeCommand('setContext', 'sequentialCursor.active', true);

  focusCurrent();
}

function confirmAndNext() {
  if (!session) { return; }
  advanceTo(session.currentIndex + 1);
}

function skipAndNext() {
  if (!session) { return; }
  advanceTo(session.currentIndex + 1);
}

function navigateNext() {
  if (!session) { return; }
  const next = (session.currentIndex + 1) % session.originalSelections.length;
  session.currentIndex = next;
  focusCurrent();
}

function navigatePrev() {
  if (!session) { return; }
  const prev = (session.currentIndex - 1 + session.originalSelections.length) % session.originalSelections.length;
  session.currentIndex = prev;
  focusCurrent();
}

function cancelSession() {
  if (!session) { return; }

  // Restore all original selections so the user is back to where they started
  const { editor, originalSelections } = session;
  if (vscode.window.visibleTextEditors.includes(editor)) {
    editor.selections = originalSelections;
  }

  cleanupSession();
  vscode.window.showInformationMessage('Sequential Cursor: Session cancelled.');
}

// ─── Core logic ───────────────────────────────────────────────────────────────

function advanceTo(nextIndex: number) {
  if (!session) { return; }

  const { originalSelections } = session;

  if (nextIndex >= originalSelections.length) {
    // All cursors visited — done!
    const count = originalSelections.length;
    cleanupSession();
    vscode.window.showInformationMessage(
      `Sequential Cursor: Done! Edited all ${count} positions.`
    );
    return;
  }

  session.currentIndex = nextIndex;
  focusCurrent();
}

function focusCurrent() {
  if (!session) { return; }

  const { editor, originalSelections, currentIndex, dimDecoration, activeDecoration, statusItem } = session;

  const current = originalSelections[currentIndex];

  // Move the real cursor to this selection (single cursor, active editing position)
  editor.selection = current;
  editor.revealRange(current, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

  // Dim all OTHER selections
  const dimRanges = originalSelections
    .filter((_, i) => i !== currentIndex)
    .map(sel => new vscode.Range(sel.start, sel.end));

  editor.setDecorations(dimDecoration, dimRanges);
  editor.setDecorations(activeDecoration, [new vscode.Range(current.start, current.end)]);

  // Update status bar
  const config = vscode.workspace.getConfiguration('sequentialCursor');
  if (config.get<boolean>('showProgressInStatusBar', true)) {
    statusItem.text = `$(edit) Sequential Cursor: ${currentIndex + 1} / ${originalSelections.length}  [↑↓] Navegar  [Tab] Siguiente  [Esc] Cancelar`;
    statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusItem.show();
  }
}

function cleanupSession() {
  if (!session) { return; }

  session.dimDecoration.dispose();
  session.activeDecoration.dispose();
  session.statusItem.dispose();
  session = undefined;

  vscode.commands.executeCommand('setContext', 'sequentialCursor.active', false);
}