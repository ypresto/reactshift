import { printNode } from 'ts-morph'
import { describe, expect, test } from 'vitest'
import { translateTemplateToJsx } from './templateToJsx.js'
import prettier from 'prettier'

describe('translateTemplateToJsx', () => {
  test('TodoMVC TodosComponent.vue', async () => {
    // From TodoMVC (MIT licensed) https://github.com/tastejs/todomvc/blob/29908f1ab19f6bb7c8ef4dcefb453f7ccc6ca291/examples/vue/src/components/TodosComponent.vue
    const vueTemplate = `\
<TodoHeader @add-todo="addTodo" />
  <main class="main" v-show="todos.length > 0">
      <div class="toggle-all-container">
          <input type="checkbox" id="toggle-all-input" class="toggle-all" v-model="toggleAllModel" :disabled="filteredTodos.value.length === 0"/>
          <label class="toggle-all-label" htmlFor="toggle-all-input"> Toggle All Input </label>
      </div>
      <ul class="todo-list">
          <TodoItem v-for="(todo, index) in filteredTodos.value" :key="todo.id" :todo="todo" :index="index"
              @delete-todo="deleteTodo" @edit-todo="editTodo" @toggle-todo="toggleTodo" />
      </ul>
  </main>
<TodoFooter :todos="todos" @delete-completed="deleteCompleted" />
`

    expect(await prettier.format(printNode(translateTemplateToJsx(vueTemplate)), { parser: 'typescript' })).toBe(
      `\
<>
  <TodoHeader onAddTodo={addTodo} />
  <main class="main">
    <div class="toggle-all-container">
      <input
        type="checkbox"
        id="toggle-all-input"
        class="toggle-all"
        modelValue={toggleAllModel}
        onUpdate:modelValue={(modelValue) => {
          toggleAllModel = modelValue;
        }}
        disabled={filteredTodos.value.length === 0}
      />
      <label class="toggle-all-label" htmlFor="toggle-all-input">
        {" "}
        Toggle All Input{" "}
      </label>
    </div>
    <ul class="todo-list">
      {filteredTodos.value.map((todo, index) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          index={index}
          onDeleteTodo={deleteTodo}
          onEditTodo={editTodo}
          onToggleTodo={toggleTodo}
        />
      ))}
    </ul>
  </main>
  <TodoFooter todos={todos} onDeleteCompleted={deleteCompleted} />
</>;
`
    )
  })
})
