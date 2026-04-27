"use client";

import { useRef } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";

import "@milkdown/kit/prose/view/style/prosemirror.css";

interface MilkdownEditorProps {
  defaultValue: string;
  onChange: (markdown: string) => void;
}

function MilkdownInner({ defaultValue, onChange }: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const defaultValueRef = useRef(defaultValue);

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, defaultValueRef.current);
          ctx
            .get(listenerCtx)
            .markdownUpdated((_ctx, markdown, prevMarkdown) => {
              if (markdown !== prevMarkdown) {
                onChangeRef.current(markdown);
              }
            });
        })
        .use(commonmark)
        .use(listener),
    []
  );

  return <Milkdown />;
}

export default function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownInner {...props} />
    </MilkdownProvider>
  );
}
