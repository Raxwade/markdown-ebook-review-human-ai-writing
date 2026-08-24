import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitChapters } from '../src/epub/split'

test('splits at ## when splitLevel is 2', () => {
    const chapters = splitChapters('# Book\n\nintro\n\n## One\n\na\n\n## Two\n\nb\n', 2)
    assert.deepEqual(chapters.map(c => c.title), ['Book', 'One', 'Two'])
})

test('author-friendly headings without a separating space still split', () => {
    const chapters = splitChapters('#Book\n\nintro\n\n##One\n\na\n\n##第二章\n\nb\n', 2)
    assert.deepEqual(chapters.map(c => c.title), ['Book', 'One', '第二章'])
    assert.deepEqual(chapters.map(c => c.startLine), [0, 4, 8])
    // Chapter source stays unchanged; compatibility rendering must not corrupt
    // the coordinates recorded in note sidecars.
    assert.equal(chapters[1]!.markdown.split('\n')[0], '##One')
})

test('Setext level-one and level-two headings split like ATX headings', () => {
    const source = 'Book\n====\n\nintro\n\nChapter\n-------\n\nbody\n'
    const chapters = splitChapters(source, 2)
    assert.deepEqual(chapters.map(c => c.title), ['Book', 'Chapter'])
    assert.deepEqual(chapters.map(c => c.level), [1, 2])
    assert.deepEqual(chapters.map(c => c.startLine), [0, 5])
})

test('splitLevel 1 keeps a Setext level-two heading in its parent chapter', () => {
    const source = 'Book\n====\n\nChapter\n-------\n\nbody\n'
    const chapters = splitChapters(source, 1)
    assert.deepEqual(chapters.map(c => c.title), ['Book'])
    assert.match(chapters[0]!.markdown, /Chapter\n-------/)
})

test('splitLevel 1 keeps ## inside its parent chapter', () => {
    const chapters = splitChapters('# One\n\n## Sub\n\na\n\n# Two\n\nb\n', 1)
    assert.deepEqual(chapters.map(c => c.title), ['One', 'Two'])
    assert.match(chapters[0]!.markdown, /## Sub/)
})

test('text before the first heading survives as its own chapter', () => {
    const chapters = splitChapters('loose preamble\n\n## One\n\na\n', 2)
    assert.equal(chapters.length, 2)
    assert.equal(chapters[0]!.title, '')
    assert.equal(chapters[0]!.level, 0)
    assert.match(chapters[0]!.markdown, /loose preamble/)
})

test('a document with no headings is one chapter', () => {
    const chapters = splitChapters('just text\n\nmore text\n', 2)
    assert.equal(chapters.length, 1)
    assert.equal(chapters[0]!.title, '')
})

test('an empty document still yields one chapter', () => {
    assert.equal(splitChapters('', 2).length, 1)
    assert.equal(splitChapters('   \n\n', 2).length, 1)
})

test('CRLF input splits identically to LF', () => {
    const lf = splitChapters('# A\n\nx\n\n## B\n\ny\n', 2)
    const crlf = splitChapters('# A\r\n\r\nx\r\n\r\n## B\r\n\r\ny\r\n', 2)
    assert.deepEqual(crlf.map(c => c.title), lf.map(c => c.title))
    assert.deepEqual(crlf.map(c => c.markdown), lf.map(c => c.markdown))
})

test('headings inside fenced code do not split', () => {
    const src = [
        '# Real',
        '',
        '```bash',
        '# this is a shell comment, not a heading',
        '## neither is this',
        '```',
        '',
        '## Also real',
        '',
    ].join('\n')
    const chapters = splitChapters(src, 2)
    assert.deepEqual(chapters.map(c => c.title), ['Real', 'Also real'])
})

test('author-friendly headings inside fenced code do not split', () => {
    const src = '#Book\n\n```markdown\n##Not a chapter\n```\n\n##Real\n'
    assert.deepEqual(splitChapters(src, 2).map(c => c.title), ['Book', 'Real'])
})

test('an inner ``` does not close a ```` block', () => {
    // CommonMark closes a fence only on the same character and at least as many
    // of them. Collapsing every fence to length 3 let the inner ``` close the
    // outer one, and the heading after it split a chapter from inside code.
    const src = [
        '# Real',
        '',
        '````markdown',
        '```',
        '# still inside the outer fence',
        '```',
        '````',
        '',
        '## Also real',
        '',
    ].join('\n')
    assert.deepEqual(splitChapters(src, 2).map(c => c.title), ['Real', 'Also real'])
})

test('a ~~~ line does not close a ``` block', () => {
    const src = '# A\n\n```\n~~~\n# not a heading\n```\n\n## B\n'
    assert.deepEqual(splitChapters(src, 2).map(c => c.title), ['A', 'B'])
})

test('tilde fences are tracked too', () => {
    const src = '# A\n\n~~~\n## not a heading\n~~~\n\n## B\n'
    assert.deepEqual(splitChapters(src, 2).map(c => c.title), ['A', 'B'])
})

test('closing hashes are stripped from the title', () => {
    assert.equal(splitChapters('## Title ##\n', 2)[0]!.title, 'Title')
})

test('startLine points at each chapter first real line', () => {
    // Notes anchor to lines in the file the user edits, so this has to survive
    // the trim that drops a chapter's leading blank lines.
    const src = ['intro', '', '# One', '', 'a', '', '', '## Two', '', 'b', ''].join('\n')
    const chapters = splitChapters(src, 2)
    assert.deepEqual(chapters.map(c => c.title), ['', 'One', 'Two'])
    assert.deepEqual(chapters.map(c => c.startLine), [0, 2, 7])

    // Every startLine must actually name the line its markdown begins with.
    const lines = src.split('\n')
    for (const c of chapters) {
        assert.equal(lines[c.startLine], c.markdown.split('\n')[0],
            `chapter ${JSON.stringify(c.title)} startLine ${c.startLine} does not match its first line`)
    }
})

test('startLine counts CRLF documents the same as LF', () => {
    const lf = splitChapters('# A\n\nx\n\n## B\n\ny\n', 2)
    const crlf = splitChapters('# A\r\n\r\nx\r\n\r\n## B\r\n\r\ny\r\n', 2)
    assert.deepEqual(crlf.map(c => c.startLine), lf.map(c => c.startLine))
})

test('a trailing # with no space before it is part of the title', () => {
    // CommonMark only treats a trailing run of # as a closing sequence when a
    // space precedes it, which is what keeps '## C#' from becoming '## C'.
    assert.equal(splitChapters('## C#\n', 2)[0]!.title, 'C#')
})

test('headings indented by up to three spaces still split', () => {
    // Three spaces is the CommonMark limit; four make an indented code block.
    // An editor that indents a heading two spaces was silently losing the break.
    const chapters = splitChapters('# A\n\nx\n\n  ## Indented\n\ny\n', 2)
    assert.deepEqual(chapters.map(c => c.title), ['A', 'Indented'])
})

test('a four-space indent is code, not a heading', () => {
    const chapters = splitChapters('# A\n\nx\n\n    ## Not a heading\n\ny\n', 2)
    assert.deepEqual(chapters.map(c => c.title), ['A'])
})

test('a bare # is an empty heading rather than a crash', () => {
    const chapters = splitChapters('intro\n\n#\n\nbody\n', 1)
    assert.deepEqual(chapters.map(c => c.title), ['', ''])
    assert.deepEqual(chapters.map(c => c.level), [0, 1])
})

test('a fence line with trailing text does not close the block', () => {
    // A closing fence may carry nothing but whitespace. Accepting '```anything'
    // as a close ended the block early and every '# comment' after it split a
    // chapter out of the middle of the code.
    const src = [
        '# Real',
        '',
        '```',
        '```not-a-close',
        '# still inside the fence',
        '```',
        '',
        '## Also real',
        '',
    ].join('\n')
    assert.deepEqual(splitChapters(src, 2).map(c => c.title), ['Real', 'Also real'])
})

test('a line opening with an inline code span is not a fence', () => {
    // A backtick fence's info string may not contain a backtick, so ```x``` in
    // prose is a code span. Reading it as a fence swallowed the rest of the file.
    const src = '# A\n\n```lang``` is how you tag it.\n\n## B\n\nbody\n'
    assert.deepEqual(splitChapters(src, 2).map(c => c.title), ['A', 'B'])
})

test('CJK headings keep their text intact', () => {
    const chapters = splitChapters('# 範例書\n\n內文\n\n## 第一章\n\n內容\n', 2)
    assert.deepEqual(chapters.map(c => c.title), ['範例書', '第一章'])
})
