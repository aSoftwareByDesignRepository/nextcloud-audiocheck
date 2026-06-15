<?php

declare(strict_types=1);

namespace OCA\AudioCheck\Command;

use OCA\AudioCheck\Service\ScanService;
use OCP\IUserManager;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

class Scan extends Command
{
	public function __construct(
		private ScanService $scan,
		private IUserManager $userManager,
	) {
		parent::__construct();
	}

	protected function configure(): void
	{
		$this
			->setName('audiocheck:scan')
			->setDescription('Scan user libraries for audio files')
			->addOption('user', 'u', InputOption::VALUE_REQUIRED, 'User ID to scan')
			->addOption('all', 'a', InputOption::VALUE_NONE, 'Scan all users');
	}

	protected function execute(InputInterface $input, OutputInterface $output): int
	{
		$all = (bool)$input->getOption('all');
		$user = $input->getOption('user');

		if ($all) {
			$this->userManager->callForSeenUsers(function ($u) use ($output): void {
				$uid = $u->getUID();
				$output->writeln('Scanning ' . $uid);
				$this->scan->scanUser($uid);
			});
			return Command::SUCCESS;
		}

		if (!is_string($user) || $user === '') {
			$output->writeln('<error>Specify --user=UID or --all</error>');
			return Command::FAILURE;
		}

		if ($this->userManager->get($user) === null) {
			$output->writeln('<error>User not found</error>');
			return Command::FAILURE;
		}

		$output->writeln('Scanning ' . $user);
		$this->scan->scanUser($user);
		return Command::SUCCESS;
	}
}
