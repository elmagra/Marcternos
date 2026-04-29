import re
import os
import sys

def resolve_conflicts(directory):
    # This regex is specifically for git conflicts
    pattern = re.compile(r'<<<<<<< HEAD\r?\n(.*?)\r?\n=======\r?\n.*?\r?\n>>>>>>> \w+\r?\n?', re.DOTALL)
    
    # Text replacements for mangled characters
    replacements = {
        'Ã¡': 'á', 'Ã©': 'é', 'Ã­': 'í', 'Ã³': 'ó', 'Ãº': 'ú', 'Ã±': 'ñ',
        'ðŸš€': '🚀', 'ðŸŒ±': '🌱', 'â›”': '⛔', 'âœ…': '✅', 'ðŸ—‘ï¸ ': '🗑️',
        'ðŸ“ ': '📁', 'ðŸ“‚': '📂', 'ðŸ” ': '🔍', 'ðŸ”—': '🔗', 'ðŸ“¥': '📥',
        'âš™ï¸ ': '⚙️', 'ðŸ“‹': '📋', 'ðŸ–¼ï¸ ': '🖼️', 'ðŸŽ‰': '🎉', 'â Œ': '❌'
    }

    print(f"Scanning directory: {directory}")
    for root, dirs, files in os.walk(directory):
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if '.git' in dirs:
            dirs.remove('.git')
            
        for file in files:
            if file.endswith(('.js', '.html', '.css', '.json', '.properties')):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                    
                    if '<<<<<<< HEAD' in content:
                        print(f"Resolving conflicts in {path}")
                        # Resolve conflicts: Keep ONLY HEAD content
                        new_content = pattern.sub(lambda m: m.group(1), content)
                        
                        # Just in case there are nested or slightly different ones
                        # We also replace the markers specifically if needed
                        
                        # Fix mangled characters
                        for m, r in replacements.items():
                            new_content = new_content.replace(m, r)
                        
                        with open(path, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                    else:
                        # Even if no conflicts, check for mangled chars
                        need_fixing = any(m in content for m in replacements.keys())
                        if need_fixing:
                            print(f"Fixing encoding in {path}")
                            new_content = content
                            for m, r in replacements.items():
                                new_content = new_content.replace(m, r)
                            with open(path, 'w', encoding='utf-8') as f:
                                f.write(new_content)

                except Exception as e:
                    print(f"Error processing {path}: {e}")

if __name__ == "__main__":
    resolve_conflicts(sys.argv[1])
