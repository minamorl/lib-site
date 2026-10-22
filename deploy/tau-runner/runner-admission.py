"""Use only runner-generated GitHub context; never workflow env or payload files."""
import os
import sys


def admitted(context):
    return (
        context.get('GITHUB_REPOSITORY') == 'minamorl/lib-site'
        and context.get('GITHUB_REF') == 'refs/heads/main'
        and context.get('GITHUB_WORKFLOW_REF')
        == 'minamorl/lib-site/.github/workflows/deploy.yml@refs/heads/main'
        and context.get('GITHUB_EVENT_NAME') in ('push', 'workflow_dispatch')
    )


if __name__ == '__main__':
    if not admitted(os.environ):
        print('Runner admission refused', file=sys.stderr)
        sys.exit(1)
    print('Runner admission accepted')
