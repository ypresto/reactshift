import { describe, expect, test } from 'vitest'
import { Project } from 'ts-morph'
import { transformRefs } from './refs.js'

describe('transformRefs', () => {
  test('useState()', () => {
    const project = new Project()
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `\
import { ref } from "vue";

const editing = ref(false);
const editInput = ref<string | null>(null);
const editText = ref("");

return (
  <button
    onClick={() => {
      // keep comment
      editing.value = true;
    }}
  >
    {/* Keep comment */}
    Edit
  </button>
);
`
    )
    transformRefs(sourceFile)

    expect(sourceFile.getFullText()).toBe(`\
import { ref } from "vue";
import { useState } from "react";

const [editing, setEditing] = useState(false);
const [editInput, setEditInput] = useState<string | null>(null);
const [editText, setEditText] = useState("");

return (
  <button
    onClick={() => {
      // keep comment
      setEditing(true);
    }}
  >
    {/* Keep comment */}
    Edit
  </button>
);
`)
  })

  test.skip('useRef()', () => {
    const project = new Project()
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `\
import { ref } from "vue";

const button1 = ref<HTMLButtonElement | null>(null);

return (
  <button ref={button1}>Button</button>
);
`
    )
    transformRefs(sourceFile)

    expect(sourceFile.getFullText()).toBe(`\
import { ref } from "vue";
import { useRef } from "react";

const button1 = useRef<HTMLButtonElement | null>(null);

return (
  <button ref={button1}>Button</button>
);
`)
  })

  test.skip('renamed import', () => {})

  test('aliased ref', () => {
    const project = new Project()
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `\
import { ref as vueRef } from "vue";

const editing = vueRef(false);

return <button onClick={() => editing.value = true}>Edit</button>;
`
    )
    transformRefs(sourceFile)

    expect(sourceFile.getFullText()).toBe(`\
import { ref as vueRef } from "vue";
import { useState } from "react";

const [editing, setEditing] = useState(false);

return <button onClick={() => setEditing(true)}>Edit</button>;
`)
  })
})
