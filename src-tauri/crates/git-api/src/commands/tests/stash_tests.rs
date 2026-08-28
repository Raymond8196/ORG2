use crate::commands::stash::{stash_list, stash_push};

fn git_in(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Regression: `git stash push` exits 0 on a clean tree without stashing
/// anything, and stash_push used to report `success: true` with a hardcoded
/// `stash@{0}` anyway — pointing callers at whatever unrelated stash was on
/// top, which a follow-up "pop what I just stashed" would then destroy.
#[test]
fn stash_push_reports_noop_and_real_stashes_truthfully() {
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }

    let repo = std::env::temp_dir().join(format!(
        "orgii-stash-int-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");

    git_in(&repo, &["init"]);
    std::fs::write(repo.join("a.txt"), "one\n").expect("write a.txt");
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "init"]);

    // A pre-existing stash sits at stash@{0} — the entry the old fabricated
    // ref would have mis-targeted.
    std::fs::write(repo.join("a.txt"), "one\nolder stashed edit\n").expect("dirty a.txt");
    let older = stash_push(&repo, None, Some("older stash"), false).expect("stash runs");
    assert!(older.success);
    assert_eq!(older.stash_ref.as_deref(), Some("stash@{0}"));

    // Clean tree: the push is a no-op and must NOT hand back a stash_ref.
    let noop = stash_push(&repo, None, Some("noop"), false).expect("stash runs");
    assert!(noop.success, "a no-op stash is not a failure");
    assert_eq!(
        noop.stash_ref, None,
        "no stash was created, so no ref may be reported: {}",
        noop.message
    );
    assert!(noop.message.contains("No local changes to save"));

    // The pre-existing stash must still be the only entry.
    let entries = stash_list(&repo).expect("stash list");
    assert_eq!(entries.len(), 1);

    // A genuinely dirty tree stashes and reports the new top entry.
    std::fs::write(repo.join("a.txt"), "one\nnewer edit\n").expect("dirty a.txt");
    let real = stash_push(&repo, None, Some("real stash"), false).expect("stash runs");
    assert!(real.success);
    assert_eq!(real.stash_ref.as_deref(), Some("stash@{0}"));
    assert_eq!(stash_list(&repo).expect("stash list").len(), 2);
    let restored = std::fs::read_to_string(repo.join("a.txt")).expect("read a.txt");
    assert!(
        !restored.contains("newer edit"),
        "the dirty edit must actually have been stashed away"
    );

    let _ = std::fs::remove_dir_all(&repo);
}
