# Bug Report 24

## Agent Rules (Read Before Any Bug Fixes)
- From AGENT_RULES.md and .github/copilot-instructions.md
- Must read these rules before attempting any bug fixes
- Must follow tripwire format: `[Task: <what you're doing> | Last: <what was just completed>]`
- Must test before shipping, no placeholder data, no guessing, no lying
- Must get approval before implementing, always present exact plan
- Never build the app - say "Ready to build" instead
- Never kill all node processes - only kill specific PIDs
- Must check PENDING_FIXES.md at start of every session

## Issues Reported

### 1. JSON Terminal Bubbles Still Appearing (Image 2)
- **Status**: NOT FIXED despite previous claims
- **Previous Fix Attempt**: Tool feedback display modification
- **Fallback Fix**: Additional tool feedback handling
- **Result**: Failed - JSON bubbles still appearing in terminal
- **Evidence**: Multiple JSON bubbles with "Copy" and "Apply" buttons visible in Image 2

### 2. Model Not Acknowledging Requests Before Tool Calls (Image 2)
- **Issue**: Model runs tool calls without acknowledging user request first
- **Issue**: Model doesn't follow up after tool call completion
- **Expected Behavior**: 
  1. Acknowledge request ("I'll help you find houses in Houston under $200k")
  2. Run tool call
  3. Follow up with results
- **Actual Behavior**: Direct tool execution without acknowledgment or follow-up
- **Evidence**: Image 2 shows tool call without proper acknowledgment

### 3. Browser Viewport Still Too Narrow (Image 1)
- **Status**: NOT FIXED despite previous viewport fixes
- **Issue**: Browser can be shrunk to very narrow width beyond expected limits
- **Previous Fix Attempt**: Viewport width constraints implementation
- **Result**: Failed - viewport still shrinkable to unusable width
- **Evidence**: Image 1 shows browser content cut off at very narrow width

### 4. New Model Loading Error (Image 4)
- **Error**: "Failed to load 'Llama-3.2-3B-Instruct-Q4_K_S'"
- **Error Details**: "Error invoking remote method 'llm-load-model': reply was never sent"
- **Status**: New error, never seen before
- **Context**: Same model works fine in LM Studio (not a model issue)

### 5. Unexpected Response in New Session (Image 3)
- **Issue**: Strange response when user said "hello" in new ICE session
- **Context**: Same model works fine in LM Studio
- **Status**: Needs investigation

## Previous Failed Fixes Documentation

### JSON Bubbles Fix Attempts:
1. **Primary Fix**: Modified tool feedback display system
   - Implementation: Changed how tool outputs are rendered
   - Result: Failed - bubbles still appear
   
2. **Fallback Fix**: Additional tool feedback handling
   - Implementation: Added secondary feedback processing
   - Result: Failed - bubbles still appear

### Browser Viewport Fix Attempts:
1. **Primary Fix**: Added viewport width constraints
   - Implementation: Set minimum width limits in browser component
   - Result: Failed - viewport still shrinkable beyond limits

## Required Actions
1. Fix JSON terminal bubbles permanently
2. Implement proper request acknowledgment before tool calls
3. Fix browser viewport minimum width constraints
4. Investigate and fix model loading error
5. Investigate unexpected session responses
6. Test all fixes thoroughly before claiming completion

## Testing Requirements
- Must verify JSON bubbles are completely eliminated
- Must verify proper acknowledgment flow: acknowledge → tool call → follow-up
- Must verify browser viewport cannot be shrunk below usable width
- Must verify model loading works without errors
- Must verify session responses are appropriate

## Notes
- User explicitly stated model works fine in LM Studio
- Do not blame model for issues
- All fixes must work for all hardware configurations (4GB to 128GB GPUs)
- Must follow all agent rules during fix implementation
