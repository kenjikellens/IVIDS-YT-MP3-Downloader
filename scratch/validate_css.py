import re

def parse_css(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    brace_level = 0
    errors = []
    
    # Simple state machine to trace syntax
    for idx, line in enumerate(lines):
        line_num = idx + 1
        stripped = line.strip()
        
        # Skip empty lines or comments
        if not stripped or stripped.startswith("/*") or stripped.startswith("*"):
            continue
            
        # Count braces on this line
        open_braces = stripped.count('{')
        close_braces = stripped.count('}')
        
        # If we see properties (containing colon) at brace_level == 0, it's a declaration outside any selector!
        if brace_level == 0 and ':' in stripped and not stripped.endswith('{'):
            # Double check if it's actually a declaration or selector (e.g. pseudo-class)
            # Pseudo classes like a:hover are selectors, they contain colons but usually end with { or are followed by {
            # Real declarations end with semicolon or look like "property: value"
            if ';' in stripped or any(stripped.startswith(p) for p in ['display', 'flex-direction', 'justify-content', 'align-items', 'margin', 'padding', 'width', 'height', 'max-height']):
                errors.append(f"Declaration outside any selector at line {line_num}: '{stripped}'")
        
        brace_level += open_braces - close_braces
        
        if brace_level < 0:
            errors.append(f"Unmatched closing brace '}}' at line {line_num}")
            brace_level = 0
            
    if brace_level > 0:
        errors.append(f"Unclosed braces (level {brace_level}) at the end of the file")
        
    for err in errors:
        print(err)

if __name__ == "__main__":
    parse_css("ui/style.css")
