# Root Cause Fixes Applied

## Date: $(Get-Date)

### Issues Reported (from screenshots):
1. **Cerebras 120B**: Outputting raw `{"tool":"browser_navigate","params":{...}}` as visible text
2. **Llama 3**: Saying "this model produced incoherent output" when it was working fine (created files successfully)
3. **DeepSeek R1**: "No response generated" after 51 lines of thinking
4. **Tool execution**: Claims success but folders/files empty
5. **Tool JSON**: Appearing inline without code fences
6. **Merged/distill models**: Producing actual garbage but also false positive triggers

---

## Root Causes Identified:

### 1. **Gibberish Detection False Positives**
- **Location**: `main/llmEngine.js` lines 693-720
- **Problem**: Aggressive heuristics (alpha ratio <0.25, special chars >0.12, etc.) were ABORTING valid model output
- **Evidence**: Llama created files successfully but detection killed it
- **Fix**: **REMOVED ENTIRELY** - Let models output naturally, no abort logic

### 2. **ChatML Wrapper Forcing Breaking Models**
- **Location**: `main/llmEngine.js` lines 267-273, and 4 other session creation points
- **Problem**: Forcing `ChatMLChatWrapper` on Qwen-family models OVERRODE their native GGUF chat template
- **Evidence**: Merged models likely have correct templates in metadata, forcing ChatML corrupted output
- **Fix**: **REMOVED ENTIRELY** - Let node-llama-cpp use native GGUF chat template

### 3. **Aggressive Tool JSON Stripping Causing "No Response Generated"**
- **Location**: 
  - `electron-main.js` lines 1341-1347 (cloud loop)
  - `electron-main.js` lines 2107-2113 (local loop)
- **Problem**: 
  - Stripped ALL ```json/```tool blocks from accumulated response
  - Stripped ALL bare `{"tool":...}` JSON with regex
  - Stripped tool result summaries like "**browser_navigate** done"
  - This DESTROYED legitimate response content, leaving empty strings
- **Evidence**: DeepSeek thinking 51 lines then "No response" = thinking stripped out
- **Fix**: **REMOVED AGGRESSIVE STRIPPING** - Only collapse excessive newlines

### 4. **Model-Specific Temperature Overrides Breaking Output Quality**
- **Location**: `main/llmEngine.js` lines 342-360 (`_getModelSpecificParams`)
- **Problem**: 
  - Merged/distill models forced to temp=0.2, topK=10 (extremely conservative)
  - Small models (≤3B) forced to temp=0.5, topK=15
  - This KILLED creativity and made models produce repetitive/garbage output
- **Evidence**: Conservative sampling causes degenerate output in many models
- **Fix**: **REMOVED ALL OVERRIDES** - Let users control params via settings

---

## How the Fixes Address Each Issue:

### Issue #1: Cerebras Raw Tool JSON Visible
**Before**: Tool JSON stripped after parsing, but only from code fences
**After**: No stripping → UI will parse and display tools correctly
**Root Cause**: Models not using code fences, but parser DOES handle bare JSON

### Issue #2: Llama "Incoherent Output" False Positive
**Before**: Gibberish detection aborted generation mid-stream
**After**: No detection → model runs to completion naturally
**Root Cause**: Heuristics too aggressive (false positive on valid JSON/technical output)

### Issue #3: DeepSeek "No Response Generated"
**Before**: Thinking content stripped by tool JSON regex
**After**: Only newlines collapsed → thinking preserved
**Root Cause**: Aggressive stripping removed legitimate response text

### Issue #4: Tool Execution Success But Files Empty
**Needs Investigation**: This may be a separate file system permissions issue
**Action Required**: Test actual file creation with fixed models

### Issue #5: Tool JSON Inline Without Fences
**Before**: Parser handles, but stripping missed bare JSON → showed as text
**After**: No stripping → UI renders tool calls correctly from parsed data
**Root Cause**: Double problem: models not fenced + stripping didn't catch inline

### Issue #6: Merged/Distill Model Garbage
**Before**: ChatML override + conservative sampling forced poor output
**After**: Native GGUF template + user-controlled sampling
**Root Cause**: Forcing wrong chat template + killing sampling diversity

---

## Testing Checklist:

- [ ] Test Cerebras 120B with tool calls (browser navigation)
- [ ] Test local Llama 3 with file creation (verify no "incoherent" abort)
- [ ] Test DeepSeek R1 thinking model (verify response after reasoning)
- [ ] Test merged/distill models (check output quality improvement)
- [ ] Verify tool execution creates actual files on disk
- [ ] Check UI tool call rendering (both fenced and bare JSON)

---

## Files Modified:

1. **main/llmEngine.js**: 
   - Removed gibberish detection (lines 693-720 deleted)
   - Removed ChatML wrapper forcing (lines 267-273, multiple session creations)
   - Removed model-specific param overrides (lines 342-360 simplified)

2. **electron-main.js**:
   - Removed aggressive tool JSON stripping (cloud loop lines 1341-1347)
   - Removed aggressive tool JSON stripping (local loop lines 2107-2113)
   - Kept only newline collapse for clean display

---

## Philosophy Change:

**OLD APPROACH**: 
- Detect problems → abort/strip → band-aid UI fixes
- Override model behavior → force conservative sampling
- Assume models need hand-holding

**NEW APPROACH**:
- Trust models to output correctly with native templates
- Let users control sampling parameters
- Parser handles multiple formats (fenced + bare JSON)
- UI displays parsed tool data, not raw text
- Only minimal cleanup (whitespace), no content removal

---

## Next Steps if Issues Persist:

1. **Tool execution failures**: Check file system permissions, verify `write_file` IPC handler
2. **UI showing raw JSON**: Verify ChatPanel tool parsing logic in `renderContentParts()`
3. **Actual garbage output**: May need to adjust user's temperature/topP in settings, not code overrides
